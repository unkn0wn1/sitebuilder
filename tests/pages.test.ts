import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { applyPageOps, checkpoint, createPage, getPage, listVersions, restoreVersion, undoOp, AUTOSAVE_MAX_GAP_MS } from '../server/services/pages'
import { setup, IMG } from './helpers'

function err(fn: () => unknown): AppError {
  try {
    fn()
  } catch (e) {
    if (e instanceof AppError) return e
    throw e
  }
  throw new Error('expected an AppError')
}

describe('pages', () => {
  it('creates pages with paths and refuses duplicate addresses', () => {
    const { ctx, editor } = setup()
    const about = createPage(ctx, editor, { title: 'About us', template: 'standard' }).page
    expect(about.path).toBe('/about-us')
    const team = createPage(ctx, editor, { title: 'Our team', template: 'standard', parentId: about.id }).page
    expect(team.path).toBe('/about-us/our-team')
    expect(err(() => createPage(ctx, editor, { title: 'About us', template: 'standard' })).code).toBe('validation_failed')
    expect(err(() => createPage(ctx, editor, { title: 'X', template: 'nope' })).code).toBe('validation_failed')
  })

  it('applies ops, validates against schemas and template rules', () => {
    const { ctx, editor } = setup()
    const { page } = createPage(ctx, editor, { title: 'Story', template: 'story' })
    const r = applyPageOps(ctx, editor, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'Hi' } } }])
    expect(r.revision).toBe(1)
    expect(r.doc.blocks[0]!.type).toBe('Quote')
    const bad = err(() => applyPageOps(ctx, editor, page.id, 1, [{ op: 'update_props', blockId: r.doc.blocks[0]!.id, props: { text: 'x'.repeat(401) } }]))
    expect(bad.code).toBe('validation_failed')
    expect(bad.fields?.[0]?.path).toBe('blocks.0.props.text')
    const notAllowed = err(() => applyPageOps(ctx, editor, page.id, 1, [{ op: 'add_block', block: { type: 'Stats', props: { items: [{ value: '1', label: 'x' }] } } }]))
    expect(notAllowed.message).toMatch(/isn't allowed on a Story page/)
    // All or nothing: the failed batches changed nothing.
    expect(getPage(ctx, page.id).revision).toBe(1)
    expect(getPage(ctx, page.id).template.rules?.allowedBlocks).toContain('VideoHero')
    expect(getPage(ctx, page.id).template.label).toBeTruthy()
  })

  it('coalesces autosaves from one person, but not across people or long gaps', () => {
    const { ctx, clock, editor, editor2 } = setup()
    const { page } = createPage(ctx, editor, { title: 'P', template: 'standard' })
    let rev = 0
    const quote = (text: string, who = editor) => {
      const r = applyPageOps(ctx, who, page.id, rev, [{ op: 'add_block', block: { type: 'Quote', props: { text } } }])
      rev = r.revision
    }
    quote('a')
    clock.advance(30_000)
    quote('b')
    expect(listVersions(ctx, page.id).filter((v) => v.kind === 'autosave')).toHaveLength(1)
    clock.advance(AUTOSAVE_MAX_GAP_MS + 1)
    quote('c')
    expect(listVersions(ctx, page.id).filter((v) => v.kind === 'autosave')).toHaveLength(2)
    quote('d', editor2)
    expect(listVersions(ctx, page.id).filter((v) => v.kind === 'autosave')).toHaveLength(3)
  })

  it('only conflicts when someone else changed the same field', () => {
    const { ctx, editor, editor2 } = setup()
    const { page } = createPage(ctx, editor, { title: 'P', template: 'standard' })
    const r1 = applyPageOps(ctx, editor, page.id, 0, [{ op: 'add_block', block: { type: 'Hero', props: { heading: 'H', image: IMG } } }])
    const id = r1.doc.blocks[0]!.id
    // Sam edits the heading at revision 1.
    applyPageOps(ctx, editor2, page.id, 1, [{ op: 'update_props', blockId: id, props: { heading: 'Sam' } }])
    // Asha, still at revision 1, edits the subheading: fine.
    expect(applyPageOps(ctx, editor, page.id, 1, [{ op: 'update_props', blockId: id, props: { subheading: 'Asha' } }]).revision).toBe(3)
    // Asha edits the heading from revision 1: conflict, with the current draft returned.
    const c = err(() => applyPageOps(ctx, editor, page.id, 1, [{ op: 'update_props', blockId: id, props: { heading: 'Asha' } }]))
    expect(c.code).toBe('conflict')
    expect(c.extra?.conflicts).toEqual([`block:${id}.heading`])
    expect((c.extra?.current as { revision: number }).revision).toBe(3)
    // Sam removes the section; Asha's stale edit to it conflicts.
    applyPageOps(ctx, editor2, page.id, 3, [{ op: 'remove_block', blockId: id }])
    expect(err(() => applyPageOps(ctx, editor, page.id, 3, [{ op: 'update_props', blockId: id, props: { subheading: 'x' } }])).code).toBe('conflict')
  })

  it('undoes one change, and refuses when someone else touched it since', () => {
    const { ctx, editor, editor2 } = setup()
    const { page } = createPage(ctx, editor, { title: 'P', template: 'standard' })
    const r1 = applyPageOps(ctx, editor, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'one' } } }])
    const id = r1.doc.blocks[0]!.id
    const r2 = applyPageOps(ctx, editor, page.id, 1, [{ op: 'update_props', blockId: id, props: { text: 'two' } }])
    const u = undoOp(ctx, editor, page.id, r2.opIds[0]!)
    expect(u.doc.blocks[0]!.props.text).toBe('one')
    expect(err(() => undoOp(ctx, editor, page.id, r2.opIds[0]!)).code).toBe('invalid_state')
    applyPageOps(ctx, editor2, page.id, u.revision, [{ op: 'update_props', blockId: id, props: { text: 'sam' } }])
    expect(err(() => undoOp(ctx, editor, page.id, r1.opIds[0]!)).code).toBe('conflict')
    expect(err(() => undoOp(ctx, editor2, page.id, r1.opIds[0]!)).code).toBe('forbidden')
  })

  it('restores an old version as a new draft without losing history', () => {
    const { ctx, editor } = setup()
    const { page } = createPage(ctx, editor, { title: 'P', template: 'standard' })
    applyPageOps(ctx, editor, page.id, 0, [{ op: 'add_block', block: { type: 'Quote', props: { text: 'one' } } }])
    const cp = checkpoint(ctx, editor, page.id, 'Before trying something')
    applyPageOps(ctx, editor, page.id, 1, [{ op: 'set_meta', title: 'Changed' }])
    const before = listVersions(ctx, page.id).length
    const r = restoreVersion(ctx, editor, page.id, cp.versionId)
    expect(r.doc.title).toBe('P')
    expect(listVersions(ctx, page.id).length).toBe(before + 1)
    expect(getPage(ctx, page.id).page.title).toBe('P')
  })

  it('moves a page and its children when the slug or parent changes', () => {
    const { ctx, editor } = setup()
    const about = createPage(ctx, editor, { title: 'About', template: 'standard' }).page
    const team = createPage(ctx, editor, { title: 'Team', template: 'standard', parentId: about.id }).page
    applyPageOps(ctx, editor, about.id, 0, [{ op: 'set_meta', slug: 'who-we-are' }])
    expect(getPage(ctx, team.id).page.path).toBe('/who-we-are/team')
    expect(err(() => applyPageOps(ctx, editor, about.id, 1, [{ op: 'set_meta', parentId: team.id }])).message).toMatch(/inside itself/)
  })
})
