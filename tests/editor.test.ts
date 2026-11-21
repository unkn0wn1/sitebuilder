import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../app/utils/api'
import { canvasScale, timeAgo } from '../app/utils/format'
import { PageEditor, type EditorApi, type EditorSnapshot, type OpsResult } from '../app/utils/page-editor'
import { newId } from '../shared/ids'
import { applyOps, OpError, opsRequestSchema, type Op, type PageMeta } from '../shared/ops'
import { emptyPageDoc, type PageDoc } from '../shared/page'
import { blockRegistry } from '../app/utils/block-fields'
import { richTextFromParagraphs } from '../shared/richtext'

const rules = { schemaVersion: 1 as const, label: 'Campaign', allowedBlocks: ['Hero', 'RichText', 'Quote', 'CallToAction'], requiredBlocks: ['Hero'], startingBlocks: [] }

function snapshot(over: Partial<EditorSnapshot> = {}): EditorSnapshot {
  const doc = over.doc ?? emptyPageDoc('Winter appeal')
  return {
    pageId: 'pg_1',
    title: doc.title,
    path: '/winter-appeal',
    templateKey: 'campaign',
    templateLabel: 'Campaign',
    state: 'draft',
    hasUnpublishedChanges: false,
    doc,
    revision: 1,
    meta: { slug: 'winter-appeal', parentId: null },
    rules,
    ...over,
  }
}

class MemoryApi implements EditorApi {
  revision: number
  state: { doc: PageDoc; meta: PageMeta }
  opIds: string[] = []
  history: OpsResult[] = []
  inverses = new Map<string, Op>()
  conflictOnce = false
  failWith: unknown = null
  calls: Op[][] = []

  constructor(doc = emptyPageDoc('Winter appeal'), revision = 1, meta: PageMeta = { slug: 'winter-appeal', parentId: null }) {
    this.state = { doc, meta }
    this.revision = revision
  }

  async applyOps(_pageId: string, baseRevision: number, ops: Op[]): Promise<OpsResult> {
    this.calls.push(ops)
    if (this.failWith) {
      const err = this.failWith
      this.failWith = null
      throw err
    }
    if (this.conflictOnce) {
      this.conflictOnce = false
      throw new ApiError(409, 'conflict', 'Someone else changed this since you last saw it.', {
        current: { revision: this.revision, doc: this.state.doc, meta: this.state.meta },
        conflicts: ['block:b_other.heading'],
      })
    }
    if (baseRevision > this.revision) throw new ApiError(409, 'conflict', 'Your copy of this page is newer than the server.')
    // Like the server: the request schema first, then all-or-nothing apply with the failing op's path.
    const parsed = opsRequestSchema.safeParse({ baseRevision, ops })
    if (!parsed.success) throw new ApiError(400, 'validation_failed', parsed.error.issues[0]!.message, { fields: [{ path: parsed.error.issues[0]!.path.join('.'), message: parsed.error.issues[0]!.message }] })
    let applied: ReturnType<typeof applyOps>
    try {
      applied = applyOps(this.state, parsed.data.ops as Op[], { registry: blockRegistry, newBlockId: () => newId('block') })
    } catch (e) {
      if (e instanceof OpError) throw new ApiError(400, 'validation_failed', e.message, { fields: [{ path: e.path, message: e.message }] })
      throw e
    }
    this.state = applied.state
    this.revision += applied.applied.length
    const opIds = applied.applied.map((a, i) => {
      const id = `op_${this.opIds.length + i + 1}`
      this.inverses.set(id, a.inverse as Op)
      return id
    })
    this.opIds.push(...opIds)
    const result = { revision: this.revision, doc: this.state.doc, meta: { ...this.state.meta, path: `/${this.state.meta.slug}` }, opIds }
    this.history.push(result)
    return result
  }

  async undo(_pageId: string, opId: string): Promise<OpsResult> {
    const inverse = this.inverses.get(opId)
    if (!inverse) throw new ApiError(404, 'not_found', "That change wasn't found.")
    return this.applyOps(_pageId, this.revision, [inverse])
  }
}

function editor(api: MemoryApi, snap?: Partial<EditorSnapshot>, opts?: ConstructorParameters<typeof PageEditor>[2]) {
  return new PageEditor(api, snapshot({ doc: api.state.doc, revision: api.revision, meta: api.state.meta, ...snap }), { debounceMs: 10, ...opts })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PageEditor', () => {
  it('applies a section locally and autosaves it as an operation', async () => {
    vi.useFakeTimers()
    const api = new MemoryApi()
    const ed = editor(api)
    ed.addSection('Hero')
    expect(ed.doc.blocks).toHaveLength(1)
    expect(ed.doc.blocks[0]!.type).toBe('Hero')
    expect(ed.selected?.type).toBe('Hero')
    expect(ed.saveStatus).toBe('saving')
    await vi.advanceTimersByTimeAsync(10)
    await ed.flush()
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]![0]!.op).toBe('add_block')
    expect(ed.saveStatus).toBe('saved')
    expect(ed.revision).toBeGreaterThan(1)
    expect(ed.undoStack).toHaveLength(1)
    ed.dispose()
  })

  it('updates a heading through update_props', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    ed.updateProps(id, { text: 'They gave him a second chance.' })
    await ed.flush()
    expect(ed.doc.blocks[0]!.props.text).toBe('They gave him a second chance.')
    expect(api.calls.at(-1)).toEqual([{ op: 'update_props', blockId: id, props: { text: 'They gave him a second chance.' } }])
    ed.dispose()
  })

  it('reorders, removes and duplicates sections', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Hero')
    ed.addSection('Quote')
    await ed.flush()
    const [hero, quote] = ed.doc.blocks
    ed.moveSection(quote!.id, 0)
    await ed.flush()
    expect(ed.doc.blocks.map((b) => b.type)).toEqual(['Quote', 'Hero'])
    ed.duplicateSection(hero!.id)
    await ed.flush()
    expect(ed.doc.blocks.map((b) => b.type)).toEqual(['Quote', 'Hero', 'Hero'])
    ed.removeSection(ed.doc.blocks[0]!.id)
    await ed.flush()
    expect(ed.doc.blocks.map((b) => b.type)).toEqual(['Hero', 'Hero'])
    ed.dispose()
  })

  it('undoes the last saved change and redo applies it again', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    ed.updateProps(id, { text: 'Changed' })
    await ed.flush()
    expect(ed.doc.blocks[0]!.props.text).toBe('Changed')
    await ed.undo()
    expect(ed.doc.blocks[0]!.props.text).not.toBe('Changed')
    ed.redo()
    await ed.flush()
    expect(ed.doc.blocks[0]!.props.text).toBe('Changed')
    ed.dispose()
  })

  it('offers Keep mine and Use theirs on a conflict', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const theirs = applyOps(api.state, [{ op: 'update_props', blockId: ed.doc.blocks[0]!.id, props: { text: "Sam's heading" } }], {
      registry: blockRegistry,
      newBlockId: () => newId('block'),
    })
    api.state = theirs.state
    api.revision += 1
    api.conflictOnce = true
    ed.updateProps(ed.doc.blocks[0]!.id, { text: 'Mine' })
    await ed.flush()
    expect(ed.saveStatus).toBe('conflict')
    expect(ed.conflict?.message).toMatch(/changed/i)
    ed.keepMine()
    await ed.flush()
    expect(ed.saveStatus).toBe('saved')
    expect(ed.doc.blocks[0]!.props.text).toBe('Mine')

    const api2 = new MemoryApi()
    const ed2 = editor(api2, {}, { debounceMs: 0 })
    ed2.addSection('Quote')
    await ed2.flush()
    const other = applyOps(api2.state, [{ op: 'update_props', blockId: ed2.doc.blocks[0]!.id, props: { text: "Sam's heading" } }], {
      registry: blockRegistry,
      newBlockId: () => newId('block'),
    })
    api2.state = other.state
    api2.revision += 1
    api2.conflictOnce = true
    ed2.updateProps(ed2.doc.blocks[0]!.id, { text: 'Mine' })
    await ed2.flush()
    ed2.useTheirs()
    expect(ed2.saveStatus).toBe('saved')
    expect(ed2.doc.blocks[0]!.props.text).toBe("Sam's heading")
    expect(ed2.pending).toHaveLength(0)
    ed.dispose()
    ed2.dispose()
  })

  it('keeps unsaved ops when offline and flushes when back', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.setOnline(false)
    ed.addSection('Quote')
    expect(ed.saveStatus).toBe('offline')
    await ed.flush()
    expect(api.calls).toHaveLength(0)
    ed.setOnline(true)
    await ed.flush()
    expect(api.calls).toHaveLength(1)
    expect(ed.saveStatus).toBe('saved')
    ed.dispose()
  })

  it('restores pending ops from browser storage after a reload', async () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0, storage })
    ed.setOnline(false)
    ed.addSection('Hero')
    expect(store.size).toBe(1)
    const reloaded = editor(api, {}, { debounceMs: 0, storage })
    expect(reloaded.doc.blocks).toHaveLength(1)
    expect(reloaded.pending).toHaveLength(1)
    reloaded.setOnline(true)
    await reloaded.flush()
    expect(reloaded.saveStatus).toBe('saved')
    expect(store.size).toBe(0)
    ed.dispose()
    reloaded.dispose()
  })

  it('refuses a section the page type does not allow', () => {
    const ed = editor(new MemoryApi())
    ed.addSection('DonationEmbed')
    expect(ed.doc.blocks).toHaveLength(0)
    expect(ed.error).toMatch(/isn't allowed/)
    ed.dispose()
  })

  it('slides the inspector to the section tab when a section is selected', () => {
    const ed = editor(new MemoryApi())
    expect(ed.inspectorTab).toBe('page')
    expect(ed.selected).toBeNull()
    ed.addSection('Quote')
    expect(ed.inspectorTab).toBe('section')
    ed.select(null)
    expect(ed.inspectorTab).toBe('page')
    ed.dispose()
  })
})

describe('saving never gets stuck', () => {
  it('saves a new section and an edit to it in the same batch, with the id the builder chose', async () => {
    vi.useFakeTimers()
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 1000 })
    ed.addSection('Quote')
    const id = ed.doc.blocks[0]!.id
    ed.updateProps(id, { text: 'Edited before the first save' })
    await vi.advanceTimersByTimeAsync(1000)
    await ed.flush()
    expect(api.calls).toHaveLength(1)
    expect(ed.saveStatus).toBe('saved')
    expect(api.state.doc.blocks[0]).toMatchObject({ id, props: { text: 'Edited before the first save' } })
    ed.dispose()
  })

  it('leaves out an op the server turns down and keeps saving later edits', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    // Someone else removes the section on the server; the builder still edits it, then edits the page title.
    api.state = { ...api.state, doc: { ...api.state.doc, blocks: [] } }
    ed.updateProps(id, { text: 'Lost edit' })
    ed.setMeta({ title: 'New title' })
    await ed.flush()
    await ed.flush()
    expect(ed.error).toMatch(/could not be saved/)
    expect(ed.pending).toHaveLength(0)
    expect(api.state.doc.title).toBe('New title')
    ed.setMeta({ title: 'Newer title' })
    await ed.flush()
    expect(ed.saveStatus).toBe('saved')
    expect(api.state.doc.title).toBe('Newer title')
    ed.dispose()
  })

  it('leaves out only the edit whose value the server turned down, shows why, and saves the rest', async () => {
    const api = new MemoryApi()
    // Like the server, check the whole document after the ops.
    const real = api.applyOps.bind(api)
    api.applyOps = async (pageId, base, ops) => {
      const bad = ops.findIndex((o) => o.op === 'update_props' && typeof (o.props as { attribution?: string }).attribution === 'string' && (o.props as { attribution: string }).attribution.startsWith('www.'))
      if (bad >= 0) {
        api.calls.push(ops)
        throw new ApiError(400, 'validation_failed', 'Links must start with https://.', { fields: [{ path: 'blocks.0.props.attribution', message: 'Links must start with https://.' }] })
      }
      return real(pageId, base, ops)
    }
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    ed.updateProps(id, { text: 'Good edit' })
    ed.updateProps(id, { attribution: 'www.example.org' })
    await ed.flush()
    expect(ed.saveIssues).toEqual([{ path: 'blocks.0.props.attribution', message: 'Links must start with https://.' }])
    expect(ed.error).toMatch(/taken back/)
    await ed.flush()
    expect(api.state.doc.blocks[0]!.props.text).toBe('Good edit')
    expect(api.state.doc.blocks[0]!.props.attribution).not.toBe('www.example.org')
    expect(ed.doc.blocks[0]!.props.text).toBe('Good edit')
    expect(ed.saveIssues).toHaveLength(1)
    ed.updateProps(id, { attribution: 'https://example.org' })
    expect(ed.saveIssues).toEqual([])
    ed.dispose()
  })

  it('sends more than 50 changes in several saves', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    for (let i = 0; i < 120; i++) ed.updateProps(id, { text: `Edit ${i}` })
    await ed.flush()
    for (let i = 0; i < 10 && ed.pending.length; i++) await ed.flush()
    expect(api.calls.slice(1).every((c) => c.length <= 50)).toBe(true)
    expect(api.state.doc.blocks[0]!.props.text).toBe('Edit 119')
    expect(ed.saveStatus).toBe('saved')
    ed.dispose()
  })

  it('flushAll says whether everything reached the server', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    for (let i = 0; i < 70; i++) ed.updateProps(ed.doc.blocks[0]!.id, { text: `Edit ${i}` })
    expect(await ed.flushAll()).toBe(true)
    expect(api.state.doc.blocks[0]!.props.text).toBe('Edit 69')
    ed.setOnline(false)
    ed.setMeta({ title: 'Offline title' })
    expect(await ed.flushAll()).toBe(false)
    ed.dispose()
  })

  it('keeps edits made while a save is in flight on the canvas', async () => {
    const api = new MemoryApi()
    const ed = editor(api, {}, { debounceMs: 0 })
    ed.addSection('Quote')
    await ed.flush()
    const id = ed.doc.blocks[0]!.id
    ed.updateProps(id, { text: 'First' })
    const saving = ed.flush()
    ed.updateProps(id, { attribution: 'Typed while saving' })
    await saving
    expect(ed.doc.blocks[0]!.props).toMatchObject({ text: 'First', attribution: 'Typed while saving' })
    await ed.flush()
    expect(api.state.doc.blocks[0]!.props).toMatchObject({ text: 'First', attribution: 'Typed while saving' })
    ed.dispose()
  })
})

describe('helpers', () => {
  it('formats relative times and canvas scale', () => {
    const now = Date.parse('2026-11-17T09:00:00+05:30')
    expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago')
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3h ago')
    expect(canvasScale(800, 1280)).toBe(800 / 1280)
    expect(canvasScale(1400, 1280)).toBe(1)
  })
})

describe('rich text fixture', () => {
  it('builds a paragraph the text section can use', () => {
    const doc = richTextFromParagraphs(['Hello'])
    expect(doc.type).toBe('doc')
  })
})
