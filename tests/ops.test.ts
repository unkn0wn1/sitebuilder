import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { applyOps, OpError, touchesConflict, type DraftState } from '../shared/ops'
import { emptyPageDoc } from '../shared/page'
import { auditEvents } from '../server/db/schema'
import { AppError } from '../server/services/errors'
import { applyPageOps, createPage, getPage, undoOp } from '../server/services/pages'
import { submitPage } from '../server/services/reviews'
import { setup } from './helpers'

const registry = createDefaultRegistry()
let n = 0
const ctx = { registry, newBlockId: () => `b_t${++n}xx` }

describe('operations', () => {
  it('every op has an inverse that restores the previous state', () => {
    const start: DraftState = { doc: emptyPageDoc('Page'), meta: { slug: 'page', parentId: null } }
    const a = applyOps(start, [
      { op: 'add_block', block: { type: 'Quote', props: { text: 'One' } } },
      { op: 'add_block', block: { type: 'Quote', props: { text: 'Two' } } },
    ], ctx)
    const [b1, b2] = a.state.doc.blocks
    const steps = [
      { op: 'update_props' as const, blockId: b1!.id, props: { text: 'Uno', attribution: 'Me' } },
      { op: 'move_block' as const, blockId: b2!.id, toIndex: 0 },
      { op: 'remove_block' as const, blockId: b1!.id },
      { op: 'set_meta' as const, title: 'New', slug: 'new' },
      { op: 'set_seo' as const, description: 'Desc', noindex: true },
    ]
    let state = a.state
    for (const step of steps) {
      const before = structuredClone(state)
      const r = applyOps(state, [step], ctx)
      const undone = applyOps(r.state, [r.applied[0]!.inverse], ctx)
      expect(undone.state).toEqual(before)
      state = r.state
    }
  })

  it('detects conflicts only on the same field or a removed section', () => {
    expect(touchesConflict(['block:b_1.heading'], ['block:b_1.heading'])).toEqual(['block:b_1.heading'])
    expect(touchesConflict(['block:b_1.heading'], ['block:b_1.subheading'])).toEqual([])
    expect(touchesConflict(['block:b_1.heading'], ['block:b_1.*'])).toEqual(['block:b_1.*'])
    expect(touchesConflict(['order:b_1'], ['order:b_1'])).toEqual([])
    expect(touchesConflict(['block:b_2.x'], ['block:b_1.*'])).toEqual([])
  })

  it('rejects ops on missing sections with a clear message', () => {
    const start: DraftState = { doc: emptyPageDoc('Page'), meta: { slug: 'page', parentId: null } }
    expect(() => applyOps(start, [{ op: 'remove_block', blockId: 'b_nope' }], ctx)).toThrow(/no longer exists/)
  })

  it('stores author CSS, restores it with the inverse, and clears whitespace', () => {
    const start: DraftState = { doc: emptyPageDoc('Page'), meta: { slug: 'page', parentId: null } }
    const added = applyOps(start, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'One' }, css: '  .a { color: red }  ' } }], ctx)
    const id = added.state.doc.blocks[0]!.id
    expect(added.state.doc.blocks[0]!.css).toBe('  .a { color: red }  ')
    expect(added.applied[0]!.op.op).toBe('restore_block')
    const styled = applyOps(added.state, [{ op: 'set_block_css', blockId: id, css: '.b { color: blue }' }], ctx)
    expect(styled.state.doc.blocks[0]!.css).toBe('.b { color: blue }')
    expect(styled.applied[0]!.touches).toEqual([`block:${id}.css`])
    expect(styled.applied[0]!.inverse).toEqual({ op: 'set_block_css', blockId: id, css: '  .a { color: red }  ' })
    const undone = applyOps(styled.state, [styled.applied[0]!.inverse], ctx)
    expect(undone.state.doc.blocks[0]!.css).toBe('  .a { color: red }  ')
    const cleared = applyOps(styled.state, [{ op: 'set_block_css', blockId: id, css: ' \n\t ' }], ctx)
    expect(cleared.state.doc.blocks[0]!.css).toBeUndefined()
    expect(cleared.applied[0]!.inverse).toEqual({ op: 'set_block_css', blockId: id, css: '.b { color: blue }' })
  })

  it('refuses css inside update_props and leaves the field alone', () => {
    const start: DraftState = { doc: emptyPageDoc('Page'), meta: { slug: 'page', parentId: null } }
    const added = applyOps(start, [{ op: 'add_block', block: { id: 'b_css01', type: 'Quote', props: { text: 'One' }, css: '.a { color: red }' } }], ctx)
    const before = structuredClone(added.state)
    expect(() => applyOps(added.state, [{ op: 'update_props', blockId: 'b_css01', props: { css: '.nope { color: blue }', text: 'Two' } }], ctx)).toThrow(OpError)
    expect(() => applyOps(added.state, [{ op: 'update_props', blockId: 'b_css01', props: { css: '.nope { color: blue }' } }], ctx)).toThrow(/Custom CSS is not one of the section fields/)
    expect(() => applyOps(added.state, [{ op: 'update_props', blockId: 'b_css01', props: {}, unset: ['css'] }], ctx)).toThrow(/Custom CSS is not one of the section fields/)
    expect(added.state).toEqual(before)
  })

  it('treats custom CSS as its own field for conflicts', () => {
    expect(touchesConflict(['block:b_1.css'], ['block:b_1.heading'])).toEqual([])
    expect(touchesConflict(['block:b_1.css'], ['block:b_1.css'])).toEqual(['block:b_1.css'])
    expect(touchesConflict(['block:b_1.css'], ['block:b_1.*'])).toEqual(['block:b_1.*'])
  })
})

const MARKER = 'MARKER9f3c'
const QUOTE = { text: 'They gave him a second chance.', attribution: 'A volunteer' }
const CSS = '  .wrap { color: #0a1b2c }  '

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e
    throw e
  }
  throw new Error('expected an AppError')
}

function pageWithQuote(s: ReturnType<typeof setup>) {
  const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'standard' })
  applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { id: 'b_css01', type: 'Quote', props: QUOTE } }])
  return page.id
}

describe('custom CSS operations', () => {
  it('lets only an admin set or clear custom CSS', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    const before = getPage(s.ctx, pageId)
    const refused = err(() => applyPageOps(s.ctx, s.editor, pageId, before.revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }]))
    expect(refused.code).toBe('forbidden')
    expect(refused.message).toBe('Custom CSS changes need an admin.')
    expect(getPage(s.ctx, pageId).revision).toBe(before.revision)
    expect(getPage(s.ctx, pageId).doc.blocks[0]!.css).toBeUndefined()

    const set = applyPageOps(s.ctx, s.admin, pageId, before.revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    expect(set.doc.blocks[0]!.css).toBe(CSS)
    const cleared = applyPageOps(s.ctx, s.admin, pageId, set.revision, [{ op: 'set_block_css', blockId: 'b_css01', css: ' \n ' }])
    expect(cleared.doc.blocks[0]!.css).toBeUndefined()
    const back = undoOp(s.ctx, s.admin, pageId, cleared.opIds[0]!)
    expect(back.doc.blocks[0]!.css).toBe(CSS)
  })

  it('rejects invalid CSS with a line and column and does not echo the source', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    const bad = err(() => applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: `a { background: url(javascript:${MARKER}) }` }]))
    expect(bad.code).toBe('validation_failed')
    expect(bad.message).toMatch(/^Line \d+, column \d+:/)
    expect(bad.message).not.toContain(MARKER)
    expect(JSON.stringify(bad.toBody())).not.toContain(MARKER)
    expect(bad.fields?.[0]?.path).toBe('blocks.0.css')
    expect(getPage(s.ctx, pageId).doc.blocks[0]!.css).toBeUndefined()
  })

  it('refuses a css key on update_props', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    const rev = getPage(s.ctx, pageId).revision
    const refused = err(() => applyPageOps(s.ctx, s.admin, pageId, rev, [{ op: 'update_props', blockId: 'b_css01', props: { css: '.nope { color: blue }', text: 'Changed' } }]))
    expect(refused.code).toBe('validation_failed')
    expect(refused.message).toBe('Custom CSS is not one of the section fields.')
    const unset = err(() => applyPageOps(s.ctx, s.editor, pageId, rev, [{ op: 'update_props', blockId: 'b_css01', props: {}, unset: ['css'] }]))
    expect(unset.message).toBe('Custom CSS is not one of the section fields.')
    const doc = getPage(s.ctx, pageId).doc
    expect(doc.blocks[0]!.css).toBe(CSS)
    expect(doc.blocks[0]!.props.text).toBe(QUOTE.text)
  })

  it('lets an editor duplicate the exact CSS and refuses any other copy', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    const rev = getPage(s.ctx, pageId).revision
    const invented = err(() => applyPageOps(s.ctx, s.editor, pageId, rev, [{ op: 'add_block', afterBlockId: 'b_css01', block: { id: 'b_css02', type: 'Quote', props: QUOTE, css: '.a { color: blue }' } }]))
    expect(invented.code).toBe('forbidden')
    expect(invented.message).toBe('Custom CSS changes need an admin.')
    const loose = err(() => applyPageOps(s.ctx, s.editor, pageId, rev, [{ op: 'add_block', block: { id: 'b_css03', type: 'Quote', props: QUOTE, css: CSS } }]))
    expect(loose.code).toBe('forbidden')
    const trimmed = err(() => applyPageOps(s.ctx, s.editor, pageId, rev, [{ op: 'add_block', afterBlockId: 'b_css01', block: { id: 'b_css04', type: 'Quote', props: QUOTE, css: CSS.trim() } }]))
    expect(trimmed.code).toBe('forbidden')
    expect(getPage(s.ctx, pageId).revision).toBe(rev)

    const copied = applyPageOps(s.ctx, s.editor, pageId, rev, [{ op: 'add_block', afterBlockId: 'b_css01', block: { id: 'b_css02', type: 'Quote', props: QUOTE, css: CSS } }])
    expect(copied.doc.blocks.find((block) => block.id === 'b_css02')?.css).toBe(CSS)
    const blank = applyPageOps(s.ctx, s.editor, pageId, copied.revision, [{ op: 'add_block', block: { id: 'b_css05', type: 'Quote', props: QUOTE, css: '  ' } }])
    expect(blank.doc.blocks.find((block) => block.id === 'b_css05')?.css).toBeUndefined()
  })

  it('keeps CSS when a section moves, and an editor can undo a removal', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    const added = applyPageOps(s.ctx, s.editor, pageId, getPage(s.ctx, pageId).revision, [{ op: 'add_block', block: { id: 'b_css02', type: 'Quote', props: QUOTE } }])
    const moved = applyPageOps(s.ctx, s.editor, pageId, added.revision, [{ op: 'move_block', blockId: 'b_css01', toIndex: 1 }])
    expect(moved.doc.blocks.map((block) => block.id)).toEqual(['b_css02', 'b_css01'])
    expect(moved.doc.blocks[1]!.css).toBe(CSS)
    const removed = applyPageOps(s.ctx, s.editor, pageId, moved.revision, [{ op: 'remove_block', blockId: 'b_css01' }])
    expect(removed.doc.blocks).toHaveLength(1)
    const restored = undoOp(s.ctx, s.editor, pageId, removed.opIds[0]!)
    expect(restored.doc.blocks.find((block) => block.id === 'b_css01')?.css).toBe(CSS)
  })

  it('an admin undo of set_block_css restores the previous text', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    const first = applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    const second = applyPageOps(s.ctx, s.admin, pageId, first.revision, [{ op: 'set_block_css', blockId: 'b_css01', css: '.wrap { color: #445566 }' }])
    const undone = undoOp(s.ctx, s.admin, pageId, second.opIds[0]!)
    expect(undone.doc.blocks[0]!.css).toBe(CSS)
  })

  it('audits the section ids and not the CSS text', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: CSS }])
    const rows = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'page.edited')).all()
    const row = rows.find((event) => Array.isArray((event.details as { cssBlocks?: unknown } | null)?.cssBlocks))
    expect(row?.details).toMatchObject({ ops: ['set_block_css'], cssBlocks: ['b_css01'] })
    expect(JSON.stringify(row?.details)).not.toContain('#0a1b2c')
    expect(JSON.stringify(row?.details)).not.toContain('wrap')
    const copy = applyPageOps(s.ctx, s.editor, pageId, getPage(s.ctx, pageId).revision, [{ op: 'add_block', afterBlockId: 'b_css01', block: { id: 'b_css02', type: 'Quote', props: QUOTE, css: CSS } }])
    expect(copy.doc.blocks[1]!.css).toBe(CSS)
    const again = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'page.edited')).all()
    const duplicate = again.find((event) => (event.details as { ops?: string[] } | null)?.ops?.includes('restore_block') && (event.details as { revision?: number } | null)?.revision === copy.revision)
    expect((duplicate?.details as { cssBlocks?: unknown } | null)?.cssBlocks).toBeUndefined()
    expect(JSON.stringify(duplicate?.details)).not.toContain('#0a1b2c')
  })

  it('warns about fixed and hidden CSS and still accepts the page', () => {
    const s = setup()
    const pageId = pageWithQuote(s)
    applyPageOps(s.ctx, s.admin, pageId, getPage(s.ctx, pageId).revision, [{ op: 'set_block_css', blockId: 'b_css01', css: '.a { position: fixed; display: none; opacity: 0.5 }' }])
    const sub = submitPage(s.ctx, s.editor, pageId)
    expect(sub.warnings.filter((warning) => warning.path === 'blocks.0.css').map((warning) => warning.message)).toEqual([
      'This CSS uses position: fixed, so it can cover other parts of the page.',
      'This CSS hides something (display: none, visibility: hidden or opacity: 0).',
    ])
  })
})
