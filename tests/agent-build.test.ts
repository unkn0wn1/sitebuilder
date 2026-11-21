// Phase 5: build several pages (and menu entries) in one change.
import { describe, expect, it } from 'vitest'
import { callOperation } from '../server/services/agent/operations'
import { richTextFromParagraphs } from '../shared/richtext'
import { enableAlwaysAllow, authenticateAgent } from '../server/services/agent/tokens'
import { PASSWORD_FOR_TESTS, PUBLISH_ALL, code, drain, world, type World } from './agent-helpers'

const REASON = 'Owner asked for an About area'
const call = (w: World, name: string, input: Record<string, unknown>) => callOperation(w.ctx, w.agent, name, input) as any
const text = (s: string) => ({ type: 'RichText', props: { content: richTextFromParagraphs([s]) } })
const ABOUT = [
  { ref: 'about', title: 'About us', page_type: 'standard', menu: { label: 'About' }, sections: [text('Who we are.')] },
  { title: 'Our team', page_type: 'standard', parent_ref: 'about', menu: { label: 'Our team', under_label: 'About' } },
]

describe('create_pages', () => {
  it('creates nested pages and menu entries as one draft change that needs a person', async () => {
    const w = await world(PUBLISH_ALL)
    const r = call(w, 'create_pages', { pages: ABOUT, reason: REASON })
    expect(r.result.pages_created.map((p: any) => p.path)).toEqual(['/about-us', '/about-us/our-team'])
    expect(r.result.menus_edited).toEqual(['main'])
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    const menu = call(w, 'get_site_part', { kind: 'menu' })
    const json = JSON.stringify(menu)
    expect(json).toContain('About')
    expect(json).toContain('Our team')
    expect(call(w, 'get_page', { path: '/about-us' }).page).toMatchObject({ is_live: false })
  })

  it('is all or nothing: a bad page later in the list creates nothing', async () => {
    const w = await world(PUBLISH_ALL)
    const pages = [...ABOUT, { title: 'Give', page_type: 'standard', sections: [{ type: 'DonationEmbed', props: {} }] }]
    expect(await code(() => call(w, 'create_pages', { pages, reason: REASON }))).toBe('never_list')
    expect(await code(() => call(w, 'get_page', { path: '/about-us' }))).toBe('not_found')
    const missingParent = [{ title: 'Child', page_type: 'standard', parent_ref: 'nope' }]
    expect(await code(() => call(w, 'create_pages', { pages: missingParent, reason: REASON }))).toBe('validation_failed')
    const badMenu = [{ title: 'Lost', page_type: 'standard', menu: { under_label: 'Nowhere' } }]
    expect(await code(() => call(w, 'create_pages', { pages: badMenu, reason: REASON }))).toBe('not_found')
    expect(await code(() => call(w, 'get_page', { path: '/lost' }))).toBe('not_found')
  })

  it('always-allow does not cover building several pages, but a rule with maxNewPages does', async () => {
    const big = [{ label: 'Build', actions: ['create_page', 'edit_menu', 'edit_text', 'edit_sections', 'edit_page_details', 'add_link'], result: 'publish', limits: { maxNewPages: 3, allowNewLinks: true } }]
    const w = await world(big)
    const r = call(w, 'create_pages', { pages: ABOUT, reason: REASON })
    expect(r.if_you_publish.outcome).toBe('goes_live')
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    expect(call(w, 'get_page', { path: '/about-us/our-team' }).page.is_live).toBe(true)

    const tight = await world([{ ...big[0], limits: { maxNewPages: 1, allowNewLinks: true } }])
    expect(call(tight, 'create_pages', { pages: ABOUT, reason: REASON }).if_you_publish.outcome).toBe('goes_to_review')

    const aa = await world([])
    enableAlwaysAllow(aa.ctx, aa.admin, aa.tokenId, { permanent: true, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    const signedIn = { ...aa, agent: authenticateAgent(aa.ctx, aa.secret, null) }
    const multi = call(signedIn, 'create_pages', { pages: ABOUT, reason: REASON })
    expect(multi.if_you_publish.outcome).toBe('goes_to_review')
    expect(multi.if_you_publish.reasons.join(' ')).toMatch(/Always-allow does not/)
    expect(call(signedIn, 'create_pages', { pages: [{ title: 'Solo', page_type: 'standard' }], reason: REASON }).if_you_publish.outcome).toBe('goes_live')
  })
})

describe('create_pages errors', () => {
  it('says which page and section is wrong, in input terms', async () => {
    const w = await world(PUBLISH_ALL)
    const e: any = await (async () => {
      try {
        call(w, 'create_pages', { pages: [{ title: 'Fine', page_type: 'standard' }, { title: 'Broken', page_type: 'standard', sections: [text('ok'), { type: 'Hero', props: { heading: 'No photo' } }] }], reason: REASON })
      } catch (x) {
        return x
      }
    })()
    expect(e.code).toBe('validation_failed')
    expect(e.message).toMatch(/^Page 2 \("Broken"\) \(pages\.1\.sections\.1\.props\.image\)/)
    expect(e.fields[0].path).toBe('pages.1.sections.1.props.image')
    expect(await code(() => call(w, 'get_page', { path: '/fine' }))).toBe('not_found')
  })
})

describe('page types as an agent sees them', () => {
  it('leaves never-list sections out of allowed types and flags page types an agent cannot make', async () => {
    const w = await world()
    const types = call(w, 'list_page_types', {}).page_types
    for (const t of types) expect(t.allowed_section_types, t.key).not.toContain('DonationEmbed')
    expect(types.find((t: any) => t.key === 'campaign')).toMatchObject({ agent_can_create: false })
    expect(types.find((t: any) => t.key === 'standard')).toMatchObject({ agent_can_create: true })
    expect(call(w, 'get_page', { path: '/events' }).page.allowed_section_types ?? []).not.toContain('Embed')
  })
})

describe('undoing a build', () => {
  it('an agent cannot undo a change that created pages; an admin undo puts parts back and takes the new pages offline', async () => {
    const { adminUndoChange } = await import('../server/services/agent/admin')
    const big = [{ label: 'Build', actions: ['create_page', 'edit_menu', 'edit_sections', 'edit_page_details', 'add_link', 'undo_change'], result: 'publish', limits: { maxNewPages: 3, allowNewLinks: true } }]
    const w = await world(big)
    const r = call(w, 'create_pages', { pages: ABOUT, reason: REASON })
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    expect(call(w, 'get_page', { path: '/about-us' }).page.is_live).toBe(true)
    const refused: any = await (async () => { try { call(w, 'undo_change', { change_id: r.change.id, reason: REASON }) } catch (e) { return e } })()
    expect(refused.code).toBe('invalid_state')
    expect(refused.message).toMatch(/admin can undo the whole change/)
    const u = adminUndoChange(w.ctx, w.admin, r.change.id, 'Not wanted after all')
    expect(u.pagesTakenOffline).toEqual(['About us', 'Our team'])
    await drain(w)
    // The first list after the undo goes live already shows the original as undone (it is an earlier row).
    const { listAllChanges } = await import('../server/services/agent/admin')
    expect(listAllChanges(w.ctx, w.admin, { limit: 10 }).find((c) => c.id === r.change.id)!.status).toBe('undone')
    expect(call(w, 'get_page', { path: '/about-us' }).page.is_live).toBe(false)
    expect(call(w, 'get_page', { path: '/about-us/our-team' }).page.is_live).toBe(false)
    expect(JSON.stringify(call(w, 'get_site_part', { kind: 'menu' }))).not.toContain('Our team')
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('undone')
  })

  it('an admin undo of a change that only created pages needs no undo change', async () => {
    const { adminUndoChange } = await import('../server/services/agent/admin')
    const w = await world([{ label: 'Pages', actions: ['create_page', 'edit_sections', 'edit_page_details'], result: 'publish' }])
    const r = call(w, 'create_pages', { pages: [{ title: 'Solo', page_type: 'standard' }], reason: REASON })
    call(w, 'publish_change', { change_id: r.change.id })
    await drain(w)
    const u = adminUndoChange(w.ctx, w.admin, r.change.id, 'Not wanted after all')
    expect(u.undoChangeId).toBeNull()
    await drain(w)
    expect(call(w, 'get_page', { path: '/solo' }).page.is_live).toBe(false)
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('undone')
  })
})

describe('approve whole change', () => {
  it('an approver approves every page and part of a change in one step', async () => {
    const { approveWholeChange, changeForReview } = await import('../server/services/agent/admin')
    const w = await world()
    const r = call(w, 'create_pages', { pages: ABOUT, reason: REASON })
    const sent = call(w, 'publish_change', { change_id: r.change.id })
    expect(sent.change.status).toBe('review')
    const { reviews } = await import('../server/db/schema')
    const firstReview = w.ctx.db.select().from(reviews).all().find((x) => x.state === 'pending')!.id
    const info = changeForReview(w.ctx, w.approver, firstReview)
    expect(info.change).toMatchObject({ id: r.change.id, pending: 3, total: 3 })
    expect(changeForReview(w.ctx, w.editor, firstReview).change).toBeNull()

    expect(await code(() => approveWholeChange(w.ctx, w.editor, r.change.id))).toBe('forbidden')
    const done = approveWholeChange(w.ctx, w.approver, r.change.id)
    expect(done.approved).toHaveLength(3)
    await drain(w)
    expect(call(w, 'get_change', { change_id: r.change.id }).change.status).toBe('published')
    expect(call(w, 'get_page', { path: '/about-us' }).page.is_live).toBe(true)
    expect(await code(() => approveWholeChange(w.ctx, w.approver, r.change.id))).toBe('invalid_state')
  })

  it('is all or nothing: one item that cannot be approved approves none', async () => {
    const { approveWholeChange } = await import('../server/services/agent/admin')
    const w = await world()
    const r = call(w, 'create_pages', { pages: ABOUT, reason: REASON })
    call(w, 'publish_change', { change_id: r.change.id })
    const { reviews } = await import('../server/db/schema')
    const { eq } = await import('drizzle-orm')
    // The approver submitted one of them themselves and self-approval is off.
    const one = w.ctx.db.select().from(reviews).where(eq(reviews.state, 'pending')).all()[0]!
    w.ctx.db.update(reviews).set({ submittedBy: w.approver.id }).where(eq(reviews.id, one.id)).run()
    expect(await code(() => approveWholeChange(w.ctx, w.approver, r.change.id))).toBe('forbidden')
    expect(w.ctx.db.select().from(reviews).where(eq(reviews.state, 'pending')).all()).toHaveLength(3)
  })
})
