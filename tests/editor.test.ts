import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../app/utils/api'
import { canvasScale, timeAgo } from '../app/utils/format'
import { PageEditor, type EditorApi, type EditorSnapshot, type OpsResult } from '../app/utils/page-editor'
import { newId } from '../shared/ids'
import { applyOps, type Op, type PageMeta } from '../shared/ops'
import { emptyPageDoc, type PageDoc } from '../shared/page'
import { blockRegistry } from '../app/utils/block-fields'
import { richTextFromParagraphs } from '../shared/richtext'

const rules = { label: 'Campaign', allowedBlocks: ['Hero', 'RichText', 'Quote', 'CallToAction'], requiredBlocks: ['Hero'], startingBlocks: [] }

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
    const applied = applyOps(this.state, ops, { registry: blockRegistry, newBlockId: () => newId('block') })
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
