// Client-side page editor: optimistic ops, 1s autosave, undo/redo, conflict handling.
import { newId } from '#shared/ids'
import { applyOps, type Op, type PageMeta } from '#shared/ops'
import type { PageDoc, PageSeo } from '#shared/page'
import type { TemplateRules } from '#shared/templates'
import { canSubmit, type WorkflowState } from '#shared/workflow'
import { ApiError } from './api'
import type { FieldIssue } from '#shared/issues'
import { blockRegistry } from './block-fields'
import { cloneDraft } from '#shared/clone'

export const DEVICE_WIDTHS = { desktop: 1280, tablet: 768, mobile: 390 } as const
export type Device = keyof typeof DEVICE_WIDTHS
export type LeftTab = 'assistant' | 'add' | 'outline'
export type InspectorTab = 'section' | 'page' | 'history'
export type SaveStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'error'

export interface EditorConflict {
  message: string
  current: { revision: number; doc: PageDoc; meta?: PageMeta }
  conflicts?: unknown
  pending: Op[]
}

export interface OpsResult {
  revision: number
  doc: PageDoc
  meta?: PageMeta & { path?: string }
  opIds: string[]
}

export interface EditorApi {
  applyOps(pageId: string, baseRevision: number, ops: Op[]): Promise<OpsResult>
  undo(pageId: string, opId: string): Promise<OpsResult>
}

export interface EditorSnapshot {
  pageId: string
  title: string
  path: string
  templateKey: string
  templateLabel: string
  state: WorkflowState
  hasUnpublishedChanges: boolean
  published?: boolean
  doc: PageDoc
  revision: number
  meta: PageMeta
  rules: TemplateRules | null
}

export interface UndoEntry {
  opIds: string[]
  ops: Op[]
}

const STORAGE_PREFIX = 'sb:editor:'
/** The server takes at most this many ops per save. */
export const MAX_OPS_PER_SAVE = 50

/** A turned-down field edit kept in the page (see PageEditor.held). Issues name their section by id. */
export interface HeldEdit {
  op: Op
  issues: { blockId?: string; path: string; message: string }[]
}

function isFieldEdit(op: Op): boolean {
  return op.op === 'update_props' || op.op === 'set_block_css' || op.op === 'set_meta' || op.op === 'set_seo'
}

function opKeys(op: Op): string[] {
  if (op.op === 'update_props') return [...Object.keys(op.props ?? {}), ...(op.unset ?? [])].map((k) => `${op.blockId}.${k}`)
  if (op.op === 'set_block_css') return [`${op.blockId}.css`]
  if (op.op === 'set_meta' || op.op === 'set_seo') return Object.keys(op).filter((k) => k !== 'op').map((k) => `${op.op}.${k}`)
  return []
}

/** Does a new op replace a held one: the same fields again, or the section removed? */
function supersedes(next: Op, held: Op): boolean {
  if (next.op === 'remove_block' && (held.op === 'update_props' || held.op === 'set_block_css')) return next.blockId === held.blockId
  const keys = new Set(opKeys(next))
  const heldKeys = opKeys(held)
  return heldKeys.length > 0 && heldKeys.every((k) => keys.has(k))
}

/** Did this field edit write the field a problem names? */
function fieldTouched(op: Op, issue: { blockId?: string; path: string }): boolean {
  if (op.op === 'update_props') {
    if (issue.blockId !== op.blockId) return false
    const prop = /^props\.([^.]+)/.exec(issue.path)?.[1]
    return !prop || opKeys(op).includes(`${op.blockId}.${prop}`)
  }
  if (op.op === 'set_block_css') return issue.blockId === op.blockId && (issue.path === 'css' || issue.path.endsWith('.css') || issue.path === '')
  return !issue.blockId && /^(title|seo|slug|meta)/.test(issue.path)
}

export class PageEditor {
  pageId: string
  title: string
  path: string
  templateKey: string
  templateLabel: string
  state: WorkflowState
  hasUnpublishedChanges: boolean
  doc: PageDoc
  revision: number
  meta: PageMeta
  rules: TemplateRules | null

  saveStatus: SaveStatus = 'saved'
  error: string | null = null
  /**
   * Field edits the server turned down (a bad link, a phone number with letters). They stay in the page and in the
   * field, with the problem shown, so nothing the person typed is lost (Spencer, 21 Nov 2026). They are not saved
   * until the field is fixed; editing that field again replaces them.
   */
  held: HeldEdit[] = []
  /** Other problems from the last turned-down save, shown until the next edit. */
  otherIssues: FieldIssue[] = []
  conflict: EditorConflict | null = null
  selectedId: string | null = null
  leftTab: LeftTab = 'add'
  inspectorTab: InspectorTab = 'page'
  device: Device = 'desktop'
  railCollapsed = false
  pending: Op[] = []
  undoStack: UndoEntry[] = []
  redoStack: Op[][] = []
  offline = false

  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private debounceMs: number
  private storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private selectedIndex = -1
  /** The last copy the server confirmed. Pending ops are replayed on it when the server turns one down. */
  private saved: { doc: PageDoc; meta: PageMeta }

  constructor(
    private readonly api: EditorApi,
    snapshot: EditorSnapshot,
    opts: { debounceMs?: number; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> } = {},
  ) {
    this.pageId = snapshot.pageId
    this.title = snapshot.title
    this.path = snapshot.path
    this.templateKey = snapshot.templateKey
    this.templateLabel = snapshot.templateLabel
    this.state = snapshot.state
    this.hasUnpublishedChanges = snapshot.hasUnpublishedChanges
    this.doc = snapshot.doc
    this.revision = snapshot.revision
    this.meta = snapshot.meta
    this.rules = snapshot.rules
    this.saved = { doc: snapshot.doc, meta: snapshot.meta }
    this.debounceMs = opts.debounceMs ?? 1000
    this.storage = opts.storage
    this.restoreOffline()
  }

  /** Problems to show next to fields: those of held edits (at the section's current place) and the rest. */
  get saveIssues(): FieldIssue[] {
    const out: FieldIssue[] = []
    for (const h of this.held) {
      for (const issue of h.issues) {
        if (!issue.blockId) {
          out.push({ path: issue.path, message: issue.message })
          continue
        }
        const index = this.doc.blocks.findIndex((b) => b.id === issue.blockId)
        if (index >= 0) out.push({ path: `blocks.${index}${issue.path ? `.${issue.path}` : ''}`, message: issue.message })
      }
    }
    return [...out, ...this.otherIssues]
  }

  get selected() {
    return this.doc.blocks.find((b) => b.id === this.selectedId) ?? null
  }

  get canSubmit(): boolean {
    return canSubmit(this.state)
  }

  get allowedTypes(): string[] {
    return this.rules?.allowedBlocks ?? blockRegistry.list().map((b) => b.type)
  }

  select(id: string | null) {
    this.selectedId = id
    this.selectedIndex = id ? this.doc.blocks.findIndex((b) => b.id === id) : -1
    if (id) this.inspectorTab = 'section'
    else if (this.inspectorTab === 'section') this.inspectorTab = 'page'
  }

  setDevice(device: Device) {
    this.device = device
  }

  setLeftTab(tab: LeftTab) {
    this.leftTab = tab
  }

  setInspectorTab(tab: InspectorTab) {
    this.inspectorTab = tab
  }

  toggleRail() {
    this.railCollapsed = !this.railCollapsed
  }

  queue(ops: Op[]) {
    if (!ops.length) return
    try {
      this.applyLocal(ops)
      this.pending.push(...ops)
      this.redoStack = []
      this.conflict = null
      this.error = null
      this.otherIssues = []
      // An edit to the same field replaces the held one: it is sent, and held again only if still not valid.
      this.held = this.held.filter((h) => !ops.some((op) => supersedes(op, h.op)))
      this.saveStatus = this.offline ? 'offline' : 'saving'
      this.persist()
      this.scheduleFlush()
    } catch (error) {
      this.fail(error)
    }
  }

  addSection(type: string, afterId?: string | null) {
    if (!this.allowedTypes.includes(type)) {
      this.error = `A "${type}" section isn't allowed on a ${this.templateLabel} page.`
      return
    }
    const def = blockRegistry.get(type)
    const props = cloneDraft((def?.sample ?? {}) as Record<string, unknown>)
    // The id is chosen here so edits to the new section can go in the same save as adding it.
    const block = { id: newId('block'), type, props }
    const op: Op = afterId ? { op: 'add_block', afterBlockId: afterId, block } : { op: 'add_block', block }
    this.queue([op])
    const last = this.doc.blocks.at(-1)
    if (afterId) {
      const idx = this.doc.blocks.findIndex((b) => b.id === afterId)
      const added = this.doc.blocks[idx + 1]
      if (added) this.select(added.id)
    } else if (last) this.select(last.id)
    this.leftTab = 'outline'
  }

  removeSection(id: string) {
    const idx = this.doc.blocks.findIndex((b) => b.id === id)
    this.queue([{ op: 'remove_block', blockId: id }])
    const next = this.doc.blocks[Math.min(idx, this.doc.blocks.length - 1)]
    this.select(next?.id ?? null)
  }

  moveSection(id: string, toIndex: number) {
    const max = this.doc.blocks.length - 1
    const clamped = Math.max(0, Math.min(max, toIndex))
    const current = this.doc.blocks.findIndex((b) => b.id === id)
    if (current < 0 || current === clamped) return
    this.queue([{ op: 'move_block', blockId: id, toIndex: clamped }])
  }

  moveSelected(delta: number) {
    if (!this.selectedId) return
    const idx = this.doc.blocks.findIndex((b) => b.id === this.selectedId)
    this.moveSection(this.selectedId, idx + delta)
  }

  duplicateSection(id: string) {
    const block = this.doc.blocks.find((b) => b.id === id)
    if (!block) return
    const copy: { id: string; type: string; props: Record<string, unknown>; css?: string } = { id: newId('block'), type: block.type, props: cloneDraft(block.props) }
    if (block.css) copy.css = block.css
    this.queue([{ op: 'add_block', afterBlockId: id, block: copy }])
    const idx = this.doc.blocks.findIndex((b) => b.id === id)
    const added = this.doc.blocks[idx + 1]
    if (added) this.select(added.id)
  }

  setBlockCss(blockId: string, css: string) {
    this.queue([{ op: 'set_block_css', blockId, css }])
  }

  updateProps(blockId: string, props: Record<string, unknown>, unset?: string[]) {
    const op: Op = unset?.length ? { op: 'update_props', blockId, props, unset } : { op: 'update_props', blockId, props }
    this.queue([op])
  }

  setMeta(patch: { title?: string; slug?: string; parentId?: string | null }) {
    this.queue([{ op: 'set_meta', ...patch }])
    if (patch.title) this.title = this.doc.title
  }

  setSeo(patch: Partial<PageSeo>) {
    this.queue([{ op: 'set_seo', ...patch }])
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.inflight) {
      await this.inflight
      if (this.pending.length) return this.flush()
      return
    }
    if (!this.pending.length || this.conflict || this.offline) return
    const ops = this.pending.slice(0, MAX_OPS_PER_SAVE)
    this.pending = this.pending.slice(MAX_OPS_PER_SAVE)
    const work = this.send(ops)
    this.inflight = work
    try {
      await work
    } finally {
      if (this.inflight === work) this.inflight = null
    }
    if (this.pending.length && !this.conflict && !this.offline) this.scheduleFlush()
  }

  /** Save everything queued (in as many saves as it takes). True only when nothing is left unsaved. */
  async flushAll(): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
      await this.flush()
      if (!this.pending.length || this.conflict || this.offline) break
    }
    return !this.pending.length && !this.conflict && !this.offline && !this.inflight && !this.held.length
  }

  setOnline(online: boolean) {
    this.offline = !online
    if (online) {
      if (this.pending.length && !this.conflict) {
        this.saveStatus = 'saving'
        void this.flush()
      }
    } else if (this.pending.length) {
      this.saveStatus = 'offline'
    }
  }

  async undo() {
    await this.flush()
    const entry = this.undoStack.pop()
    if (!entry) return
    try {
      let last: OpsResult | undefined
      for (const opId of [...entry.opIds].reverse()) {
        last = await this.api.undo(this.pageId, opId)
        this.adopt(last)
      }
      this.redoStack.push(entry.ops)
      this.saveStatus = 'saved'
      this.persist(true)
    } catch (error) {
      this.undoStack.push(entry)
      this.fail(error)
    }
  }

  redo() {
    const ops = this.redoStack.pop()
    if (!ops) return
    this.queue(ops)
  }

  keepMine() {
    const conflict = this.conflict
    if (!conflict) return
    this.adoptCurrent(conflict.current)
    this.conflict = null
    this.pending = []
    this.queue(conflict.pending)
  }

  useTheirs() {
    const conflict = this.conflict
    if (!conflict) return
    this.adoptCurrent(conflict.current)
    this.pending = []
    this.conflict = null
    this.error = null
    this.saveStatus = 'saved'
    this.persist(true)
  }

  /** Adopt a fresh document from the server (after the assistant changes the draft). */
  replaceFromServer(input: { doc: PageDoc; revision: number; meta?: PageMeta; path?: string; title?: string; state?: WorkflowState }) {
    this.doc = input.doc
    this.revision = input.revision
    if (input.meta) this.meta = input.meta
    if (input.path) this.path = input.path
    if (input.title) this.title = input.title
    if (input.state) this.state = input.state
    this.saved = { doc: this.doc, meta: this.meta }
    this.applyHeld()
    this.reselect()
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
  }

  /** Which ops in a turned-down save to leave out: the one named, or the ones that touched the fields named. */
  private rejectedOps(fields: FieldIssue[], ops: Op[]): Set<number> {
    const named = /^ops\.(\d+)(?:\.|$)/.exec(fields[0]?.path ?? '')
    if (named && Number(named[1]) < ops.length) return new Set([Number(named[1])])
    // The whole document is checked after the ops: map "blocks.N.props.key" back to the ops that wrote it.
    let after: PageDoc | null = null
    try {
      after = applyOps(this.saved, ops, { registry: blockRegistry, newBlockId: () => newId('block') }).state.doc
    } catch {
      after = null
    }
    const bad = new Set<string>()
    let meta = false
    for (const f of fields) {
      const m = /^blocks\.(\d+)\.props\.([^.]+)/.exec(f.path ?? '')
      const id = m && after ? after.blocks[Number(m[1])]?.id : undefined
      if (id) bad.add(`${id}.${m![2]}`)
      const css = /^blocks\.(\d+)\.css$/.exec(f.path ?? '')
      const cssId = css && after ? after.blocks[Number(css[1])]?.id : undefined
      if (cssId) bad.add(`${cssId}.css`)
      if (/^(title|seo\.|slug)/.test(f.path ?? '')) meta = true
    }
    const drop = new Set<number>()
    ops.forEach((op, i) => {
      if (op.op === 'update_props' && [...Object.keys(op.props ?? {}), ...(op.unset ?? [])].some((k) => bad.has(`${op.blockId}.${k}`))) drop.add(i)
      if (op.op === 'set_block_css' && bad.has(`${op.blockId}.css`)) drop.add(i)
      if (op.op === 'add_block' && op.block.id && [...bad].some((b) => b.startsWith(`${op.block.id}.`))) drop.add(i)
      if (meta && (op.op === 'set_meta' || op.op === 'set_seo')) drop.add(i)
    })
    if (!drop.size) ops.forEach((_, i) => drop.add(i))
    return drop
  }

  /** Put held edits back on top of a fresh copy from the server. One that no longer applies is let go. */
  private applyHeld() {
    const still: HeldEdit[] = []
    for (const h of this.held) {
      try {
        this.applyLocal([h.op])
        still.push(h)
      } catch {
        // Its section is gone.
      }
    }
    this.held = still
  }

  private applyLocal(ops: Op[]) {
    const result = applyOps({ doc: this.doc, meta: this.meta }, ops, { registry: blockRegistry, newBlockId: () => newId('block') })
    this.doc = result.state.doc
    this.meta = result.state.meta
    this.title = result.state.doc.title
    this.reselect()
  }

  private adopt(result: OpsResult) {
    this.doc = result.doc
    this.revision = result.revision
    if (result.meta) {
      this.meta = { slug: result.meta.slug, parentId: result.meta.parentId }
      if (result.meta.path) this.path = result.meta.path
    }
    this.title = result.doc.title
    this.saved = { doc: this.doc, meta: this.meta }
    // Ops queued while this save was in flight still apply on top of what the server sent back.
    if (this.pending.length) {
      try {
        const replay = applyOps({ doc: this.doc, meta: this.meta }, this.pending, { registry: blockRegistry, newBlockId: () => newId('block') })
        this.doc = replay.state.doc
        this.meta = replay.state.meta
        this.title = this.doc.title
      } catch {
        // The next save reports it.
      }
    }
    this.applyHeld()
    this.reselect()
  }

  private adoptCurrent(current: EditorConflict['current']) {
    this.doc = current.doc
    this.revision = current.revision
    if (current.meta) this.meta = current.meta
    this.title = current.doc.title
    this.saved = { doc: this.doc, meta: this.meta }
    this.applyHeld()
    this.reselect()
  }

  private reselect() {
    if (this.selectedId && this.doc.blocks.some((b) => b.id === this.selectedId)) {
      this.selectedIndex = this.doc.blocks.findIndex((b) => b.id === this.selectedId)
      return
    }
    if (this.selectedIndex >= 0 && this.doc.blocks[this.selectedIndex]) {
      this.selectedId = this.doc.blocks[this.selectedIndex]!.id
      return
    }
    this.selectedId = null
    this.selectedIndex = -1
  }

  private scheduleFlush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
  }

  private async send(ops: Op[]) {
    this.saveStatus = 'saving'
    try {
      const result = await this.api.applyOps(this.pageId, this.revision, ops)
      this.adopt(result)
      this.undoStack.push({ opIds: result.opIds, ops })
      this.saveStatus = this.pending.length ? 'saving' : 'saved'
      this.persist(true)
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'conflict' && error.status !== 401 && error.status !== 403) {
        this.dropRejected(error, ops)
        return
      }
      // Put the ops back so Keep mine / retry / offline still has them.
      this.pending = [...ops, ...this.pending]
      this.fail(error, ops)
    }
  }

  /**
   * The server turned the save down (all or nothing). Sending the same ops again would fail the same way and block
   * every later save, so leave out the ops it named (or the whole batch if it named none) and carry on saving the
   * rest. A turned-down field edit is held: it stays in the page and the field with its problem, unsaved, until the
   * field is fixed. Anything else (adding, moving or removing a section) is taken back.
   */
  private dropRejected(error: ApiError, ops: Op[]) {
    const fields = Array.isArray(error.details.fields) ? (error.details.fields as FieldIssue[]) : []
    const drop = this.rejectedOps(fields, ops)
    const keep = ops.filter((_, i) => !drop.has(i))
    let after: PageDoc | null = null
    try {
      after = applyOps(this.saved, ops, { registry: blockRegistry, newBlockId: () => newId('block') }).state.doc
    } catch {
      after = null
    }
    // Server paths name sections by place ("blocks.2.props.cta.href"); keep them by id so moves don't lose them.
    const located = fields
      .filter((f) => typeof f.path === 'string')
      .map((f) => {
        const m = /^blocks\.(\d+)(?:\.(.*))?$/.exec(f.path!)
        const blockId = m && after ? after.blocks[Number(m[1])]?.id : undefined
        if (blockId) return { blockId, path: m![2] ?? '', message: f.message }
        const o = /^ops\.(\d+)(?:\.(.*))?$/.exec(f.path!)
        const op = o ? ops[Number(o[1])] : undefined
        if (op?.op === 'update_props') return { blockId: op.blockId, path: o![2] ?? '', message: f.message }
        return { path: o ? (o[2] ?? '') : f.path!, message: f.message }
      })
    const newlyHeld: HeldEdit[] = []
    const takenBack: Op[] = []
    ops.forEach((op, i) => {
      if (!drop.has(i)) return
      // A bad value is held; an edit to a section that is gone is taken back.
      if (error.code === 'validation_failed' && error.details.reason !== 'missing_block' && isFieldEdit(op)) {
        const issues = located.filter((l) => fieldTouched(op, l))
        newlyHeld.push({ op, issues: issues.length ? issues : located.length === 1 ? located : [{ blockId: op.op === 'update_props' || op.op === 'set_block_css' ? op.blockId : undefined, path: op.op === 'set_block_css' ? 'css' : '', message: error.message }] })
      } else takenBack.push(op)
    })
    const held = [...this.held, ...newlyHeld]
    const replay = [...keep, ...this.pending]
    this.doc = this.saved.doc
    this.meta = this.saved.meta
    this.title = this.saved.doc.title
    this.pending = []
    for (const op of replay) {
      try {
        this.applyLocal([op])
        this.pending.push(op)
      } catch {
        // It no longer applies on the saved copy; leave it out too.
      }
    }
    this.held = held
    this.applyHeld()
    this.otherIssues = takenBack.length ? located.filter((l) => !newlyHeld.some((h) => h.issues.includes(l))).map((l) => ({ path: l.path, message: l.message })) : []
    this.error = takenBack.length
      ? `${error.message} That change could not be saved, so it was taken back.`
      : `${error.message} What you typed is kept, but it isn't saved until it's fixed.`
    this.saveStatus = this.pending.length ? 'saving' : 'error'
    this.persist()
    if (this.pending.length) this.scheduleFlush()
  }

  private fail(error: unknown, pendingForConflict?: Op[]) {
    if (error instanceof ApiError && error.code === 'conflict') {
      const current = (error.details.current ?? {}) as EditorConflict['current']
      this.conflict = {
        message: error.message,
        current: current.revision !== undefined && current.doc ? current : { revision: this.revision, doc: this.doc, meta: this.meta },
        conflicts: error.details.conflicts,
        pending: pendingForConflict ?? [...this.pending],
      }
      this.saveStatus = 'conflict'
      return
    }
    const network = error instanceof TypeError || (error instanceof ApiError && error.status === 0)
    if (network || this.offline) {
      this.offline = true
      this.saveStatus = 'offline'
      this.persist()
      return
    }
    this.error = error instanceof Error ? error.message : 'Could not save that change.'
    this.saveStatus = 'error'
  }

  private persist(clear = false) {
    if (!this.storage) return
    const key = STORAGE_PREFIX + this.pageId
    if (!this.held.length && (clear || (!this.pending.length && !this.conflict))) {
      this.storage.removeItem(key)
      return
    }
    this.storage.setItem(key, JSON.stringify({ revision: this.revision, pending: clear ? [] : this.pending, held: this.held, doc: this.doc, meta: this.meta }))
  }

  private restoreOffline() {
    if (!this.storage) return
    const raw = this.storage.getItem(STORAGE_PREFIX + this.pageId)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as { revision: number; pending: Op[]; held?: HeldEdit[] }
      if (saved.revision !== this.revision) return
      if (Array.isArray(saved.pending) && saved.pending.length) {
        this.pending = saved.pending
        this.applyLocal(saved.pending)
        this.saveStatus = this.offline ? 'offline' : 'saving'
        if (!this.offline) this.scheduleFlush()
      }
      if (Array.isArray(saved.held) && saved.held.length) {
        this.held = saved.held
        this.applyHeld()
        if (!this.pending.length) this.saveStatus = 'error'
      }
    } catch {
      this.storage.removeItem(STORAGE_PREFIX + this.pageId)
    }
  }
}
