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
