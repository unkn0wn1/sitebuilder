// Client-side page editor: optimistic ops, 1s autosave, undo/redo, conflict handling.
import { newId } from '#shared/ids'
import { applyOps, type Op, type PageMeta } from '#shared/ops'
import type { PageDoc, PageSeo } from '#shared/page'
import type { TemplateRules } from '#shared/templates'
import { canSubmit, type WorkflowState } from '#shared/workflow'
import { ApiError } from './api'
import { blockRegistry } from './block-fields'

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
    this.debounceMs = opts.debounceMs ?? 1000
    this.storage = opts.storage
    this.restoreOffline()
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
    this.applyLocal(ops)
    this.pending.push(...ops)
    this.redoStack = []
    this.conflict = null
    this.error = null
    this.saveStatus = this.offline ? 'offline' : 'saving'
    this.persist()
    this.scheduleFlush()
  }

  addSection(type: string, afterId?: string | null) {
    if (!this.allowedTypes.includes(type)) {
      this.error = `A "${type}" section isn't allowed on a ${this.templateLabel} page.`
      return
    }
    const def = blockRegistry.get(type)
    const props = structuredClone((def?.sample ?? {}) as Record<string, unknown>)
    const op: Op = afterId ? { op: 'add_block', afterBlockId: afterId, block: { type, props } } : { op: 'add_block', block: { type, props } }
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
    this.queue([{ op: 'add_block', afterBlockId: id, block: { type: block.type, props: structuredClone(block.props) } }])
    const idx = this.doc.blocks.findIndex((b) => b.id === id)
    const added = this.doc.blocks[idx + 1]
    if (added) this.select(added.id)
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
    const ops = this.pending
    this.pending = []
    const work = this.send(ops)
    this.inflight = work
    try {
      await work
    } finally {
      if (this.inflight === work) this.inflight = null
    }
    if (this.pending.length && !this.conflict && !this.offline) this.scheduleFlush()
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
    this.reselect()
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
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
    this.reselect()
  }

  private adoptCurrent(current: EditorConflict['current']) {
    this.doc = current.doc
    this.revision = current.revision
    if (current.meta) this.meta = current.meta
    this.title = current.doc.title
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
      // Put the ops back so Keep mine / retry / offline still has them.
      this.pending = [...ops, ...this.pending]
      this.fail(error, ops)
    }
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
    if (clear || (!this.pending.length && !this.conflict)) {
      this.storage.removeItem(key)
      return
    }
    this.storage.setItem(key, JSON.stringify({ revision: this.revision, pending: this.pending, doc: this.doc, meta: this.meta }))
  }

  private restoreOffline() {
    if (!this.storage) return
    const raw = this.storage.getItem(STORAGE_PREFIX + this.pageId)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as { revision: number; pending: Op[] }
      if (saved.revision === this.revision && Array.isArray(saved.pending) && saved.pending.length) {
        this.pending = saved.pending
        this.applyLocal(saved.pending)
        this.saveStatus = this.offline ? 'offline' : 'saving'
        if (!this.offline) this.scheduleFlush()
      }
    } catch {
      this.storage.removeItem(STORAGE_PREFIX + this.pageId)
    }
  }
}
