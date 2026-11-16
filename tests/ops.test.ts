import { describe, expect, it } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { applyOps, touchesConflict, type DraftState } from '../shared/ops'
import { emptyPageDoc } from '../shared/page'

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
})
