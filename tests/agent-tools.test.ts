import { describe, expect, it } from 'vitest'
import { callOperation } from '../server/services/agent/operations'
import { applyPageOps, createPage, getPage, readDoc, requirePage } from '../server/services/pages'
import { createSitePart } from '../server/services/site-parts'
import { richTextToMarkdown } from '../shared/agent/content'
import { richTextFromParagraphs } from '../shared/richtext'
import { PUBLISH_ALL, SIGNUP, code, drain, world, type World } from './agent-helpers'

const REASON = 'Testing the agent gateway'
const call = (w: World, name: string, input: Record<string, unknown>) => callOperation(w.ctx, w.agent, name, input) as any
const draftDoc = (w: World, id = w.pageId) => readDoc(w.ctx, requirePage(w.ctx, id).draftVersionId!)
const blockOf = (w: World, type: string) => draftDoc(w).blocks.find((b) => b.type === type)!

describe('reading', () => {
  it('describes the site, what the token may do, and the never-list', async () => {
    const w = await world()
    const r = call(w, 'get_site', {})
    expect(r.site.name).toBe('Test charity')
    expect(r.you).toMatchObject({ token_name: 'Claude at 3am', access: 'draft', can_publish_by_yourself: true })
    expect(r.never_list.sections_that_cannot_be_touched).toEqual(['DonationEmbed', 'Embed'])
    expect(r.actions.remove_link).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain(w.secret)
  })

  it('lists, finds and reads pages by id or address', async () => {
    const w = await world()
    expect(call(w, 'list_pages', { query: 'event' }).pages.map((p: any) => p.path)).toEqual(['/events'])
    const byPath = call(w, 'get_page', { path: '/events' })
    expect(byPath.page.page_id).toBe(w.pageId)
    expect(byPath.page.is_live).toBe(true)
    expect(byPath.sections.map((s: any) => s.type)).toEqual(['RichText', 'Hero'])
    expect(byPath.sections[0].rich_text[0].markdown).toContain('Join us [here](')
    expect(byPath.sections[0].links[0]).toMatchObject({ kind: 'text_link', href: SIGNUP, removable: true })
    expect(call(w, 'get_page', { page_id: w.pageId }).page.title).toBe('Events')
    expect(await code(() => call(w, 'get_page', { path: '/nope' }))).toBe('not_found')
    expect(await code(() => call(w, 'get_page', {}))).toBe('validation_failed')
  })

  it('reads site parts, components and page types', async () => {
    const w = await world()
    const menu = call(w, 'get_site_part', { kind: 'menu' })
    expect(menu.document.items).toHaveLength(2)
    expect(menu.links[0].kind).toBe('menu_target')
    const comps = call(w, 'list_components', {}).components
    expect(comps.find((c: any) => c.type === 'DonationEmbed').agent_access).toBe('never')
    expect(comps.find((c: any) => c.type === 'ImpactTiers').agent_access).toBe('draft_only')
    expect(comps.find((c: any) => c.type === 'RichText')).toMatchObject({ agent_access: 'ok' })
    expect(comps.find((c: any) => c.type === 'RichText').props_schema).toBeTruthy()
    expect(call(w, 'list_page_types', {}).page_types.map((t: any) => t.key)).toContain('standard')
    expect(await code(() => call(w, 'get_site_part', { kind: 'banner' }))).toBe('not_found')
  })

  it('searches words across pages and site parts, with live status', async () => {
    const w = await world()
    const r = call(w, 'search_content', { query: 'sign up' })
    expect(r.results.map((x: any) => x.target.label).sort()).toEqual(['Events', 'Menu'])
    expect(r.results.every((x: any) => x.in_live)).toBe(true)
    applyPageOps(w.ctx, w.editor, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'update_props', blockId: blockOf(w, 'Hero').id, props: { heading: 'Brand new heading' } }])
    expect(call(w, 'search_content', { query: 'brand new' }).results[0]).toMatchObject({ in_live: false, block_type: 'Hero' })
  })

  it('finds links by exact address, prefix and domain, and says which cannot be removed alone', async () => {
    const w = await world()
    expect(call(w, 'find_links', { url: 'https://OLD-SIGNUP.example.com/winter/', match: 'exact' }).total).toBe(3)
    expect(call(w, 'find_links', { url: 'https://old-signup.example.com/', match: 'prefix' }).total).toBe(3)
    expect(call(w, 'find_links', { url: 'old-signup.example.com', match: 'domain' }).total).toBe(3)
    expect(call(w, 'find_links', { url: 'https://other.example.com/' }).total).toBe(0)
  })
})

describe('editing text', () => {
  it('changes words everywhere, checks the count, and reports what it did', async () => {
    const w = await world([])
    const r = call(w, 'edit_text', { find: 'Sign up', replace: 'Join in', everywhere: true, expected_matches: 2, reason: REASON })
    expect(r.result.replaced).toBe(2)
    expect(r.change.targets.map((t: any) => t.label).sort()).toEqual(['Events', 'Menu'])
    expect(r.change.targets[0].text_changes.length + r.change.targets[1].text_changes.length).toBeGreaterThan(0)
    expect(JSON.stringify(draftDoc(w))).toContain('Join in')
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.next_steps[0]).toMatch(/NOT make this live|publish_change would NOT/)
  })

  it('refuses a wrong count without changing anything, and a missing phrase', async () => {
    const w = await world()
    const e = await code(() => call(w, 'edit_text', { find: 'Sign up', replace: 'x', everywhere: true, expected_matches: 5, reason: REASON }))
    expect(e).toBe('match_count_mismatch')
    expect(await code(() => call(w, 'edit_text', { find: 'zebra', replace: 'x', path: '/events', reason: REASON }))).toBe('no_matches')
    expect(await code(() => call(w, 'edit_text', { find: 'a', replace: 'b', reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w, 'edit_text', { find: 'a', replace: 'b', everywhere: true, path: '/events', reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w, 'edit_text', { find: 'a', replace: 'b', path: '/events', reason: 'x' }))).toBe('validation_failed')
  })

  it('batches several edits into one change when given its id', async () => {
    const w = await world()
    const a = call(w, 'edit_text', { find: 'Join us', replace: 'Come along', path: '/events', reason: REASON })
    const b = call(w, 'edit_text', { find: 'Sign up', replace: 'Join in', path: '/events', change_id: a.change.id, reason: REASON })
    expect(b.change.id).toBe(a.change.id)
    expect(b.change.targets).toHaveLength(1)
    expect(b.change.targets[0].actions).toEqual(['edit_text'])
  })

  it('inserts markdown into rich text at the end, start or after some words', async () => {
    const w = await world()
    const rt = blockOf(w, 'RichText')
    const r = call(w, 'insert_rich_text', { path: '/events', block_id: rt.id, markdown: '## Cookies\n\nWe use **one** cookie.', position: { after_text: 'tonight' }, reason: REASON })
    expect(r.result.now_reads).toContain('## Cookies')
    expect(r.result.now_reads.indexOf('tonight')).toBeLessThan(r.result.now_reads.indexOf('Cookies'))
    expect(await code(() => call(w, 'insert_rich_text', { path: '/events', block_id: rt.id, markdown: 'x', position: { after_text: 'nowhere' }, reason: REASON }))).toBe('no_matches')
    expect(await code(() => call(w, 'insert_rich_text', { path: '/events', block_id: blockOf(w, 'Hero').id, markdown: 'x', reason: REASON }))).toBe('validation_failed')
    expect(await code(() => call(w, 'insert_rich_text', { path: '/events', block_id: rt.id, markdown: '[x](javascript:alert(1))', reason: REASON }))).toBe('validation_failed')
  })
})

describe('editing links', () => {
  it('replaces an address everywhere, and tells the owner a new link needs approval', async () => {
    const w = await world([{ label: 'All but links', actions: ['edit_text', 'remove_link'], result: 'publish' }])
    const r = call(w, 'replace_link', { url: SIGNUP, new_url: 'https://new.example.org/winter', everywhere: true, expected_matches: 3, reason: REASON })
    expect(r.result.links_changed).toBe(3)
    expect(JSON.stringify(draftDoc(w))).not.toContain(SIGNUP)
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(await code(() => call(w, 'replace_link', { url: 'https://new.example.org/winter', new_url: 'javascript:alert(1)', everywhere: true, reason: REASON }))).toBe('validation_failed')
  })

  it('lets a rule allow replacing links to one domain only', async () => {
    const w = await world([{ label: 'Own domain', actions: ['add_link'], result: 'publish', limits: { allowNewLinks: true, allowedLinkDomains: ['new.example.org'] } }])
    const ok = call(w, 'replace_link', { url: SIGNUP, new_url: 'https://new.example.org/x', everywhere: true, reason: REASON })
    expect(ok.if_you_publish.outcome).toBe('goes_live')
    const w2 = await world([{ label: 'Own domain', actions: ['add_link'], result: 'publish', limits: { allowNewLinks: true, allowedLinkDomains: ['new.example.org'] } }])
    expect(call(w2, 'replace_link', { url: SIGNUP, new_url: 'https://elsewhere.example.net/x', everywhere: true, reason: REASON }).if_you_publish.outcome).toBe('goes_to_review')
  })

  it('reports links a section cannot lose, and removes the rest on request', async () => {
    const w = await world()
    applyPageOps(w.ctx, w.editor, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'add_block', block: { type: 'CallToAction', props: { heading: 'Sign up', button: { label: 'Go', href: SIGNUP } } } }])
    const e: any = await (async () => { try { call(w, 'remove_link', { url: SIGNUP, everywhere: true, reason: REASON }) } catch (x) { return x } })()
    expect(e.code).toBe('validation_failed')
    expect(e.extra.could_not_remove[0].why).toMatch(/CallToAction/)
    const r = call(w, 'remove_link', { url: SIGNUP, everywhere: true, skip_unremovable: true, reason: REASON })
    expect(r.result.complete).toBe(false)
    expect(r.result.links_removed).toBe(3)
    expect(r.result.could_not_remove).toHaveLength(1)
  })

  it('removes a menu item that has no sub-items, and reports one that has', async () => {
    const w = await world()
    const menu = call(w, 'get_site_part', { kind: 'menu' })
    expect(menu.part.key).toBe('main')
    const r = call(w, 'remove_menu_item', { label: 'sign up', reason: REASON })
    expect(r.result.menu_now.map((i: any) => i.label)).toEqual(['Home'])
    expect(await code(() => call(w, 'remove_menu_item', { label: 'Nothing', reason: REASON }))).toBe('not_found')
  })
})

describe('sections, details, pages, menus and banner', () => {
  it('adds, edits, moves and removes sections', async () => {
    const w = await world()
    const add = call(w, 'add_component', { path: '/events', type: 'Quote', props: w.ctx.registry.get('Quote')!.sample, index: 0, reason: REASON })
    expect(add.result.sections_now[0].type).toBe('Quote')
    const hero = blockOf(w, 'Hero')
    const edit = call(w, 'edit_component', { path: '/events', block_id: hero.id, props: { heading: 'Events this winter' }, change_id: add.change.id, reason: REASON })
    expect(edit.change.targets).toHaveLength(1)
    expect(await code(() => call(w, 'edit_component', { path: '/events', block_id: hero.id, props: { heading: '' }, reason: REASON }))).toBe('validation_failed')
    const move = call(w, 'move_component', { path: '/events', block_id: hero.id, to_index: 0, change_id: add.change.id, reason: REASON })
    expect(move.result.sections_now[0].type).toBe('Hero')
    const quote = blockOf(w, 'Quote')
    const rm = call(w, 'remove_component', { path: '/events', block_id: quote.id, change_id: add.change.id, reason: REASON })
    expect(rm.result.sections_now.map((s: any) => s.type)).toEqual(['Hero', 'RichText'])
    expect(await code(() => call(w, 'add_component', { path: '/events', type: 'NoSuchType', props: {}, reason: REASON }))).toBe('validation_failed')
  })

  it('changes title, search description and address', async () => {
    const w = await world()
    const r = call(w, 'set_page_details', { path: '/events', title: 'What is on', seo_description: 'Our events this winter.', slug: 'whats-on', reason: REASON })
    expect(r.result).toMatchObject({ title: 'What is on', path: '/whats-on' })
    expect(await code(() => call(w, 'set_page_details', { path: '/whats-on', reason: REASON }))).toBe('validation_failed')
  })

  it('creates a page as a draft that needs a person, and discarding removes it', async () => {
    const w = await world(PUBLISH_ALL.map((r) => ({ ...r, actions: ['edit_text'] })))
    const r = call(w, 'create_page', { title: 'Our volunteers', page_type: 'standard', sections: [{ type: 'RichText', props: { content: richTextFromParagraphs(['Thank you.']) } }], reason: REASON })
    expect(r.result.path).toBe('/our-volunteers')
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    const created = call(w, 'get_page', { path: '/our-volunteers' })
    expect(created.page).toMatchObject({ is_live: false, state: 'draft' })
    expect(created.sections.at(-1).type).toBe('RichText')
    call(w, 'discard_change', { change_id: r.change.id })
    expect(await code(() => call(w, 'get_page', { path: '/our-volunteers' }))).toBe('not_found')
  })

  it('refuses to create a page when a rule denies it', async () => {
    const w = await world([{ label: 'No new pages', actions: ['create_page'], result: 'deny' }])
    expect(await code(() => call(w, 'create_page', { title: 'X', page_type: 'standard', reason: REASON }))).toBe('rule_denied')
    expect(await code(() => call(w, 'get_page', { path: '/x' }))).toBe('not_found')
  })

  it('adds, renames and removes menu items, and sets the banner', async () => {
    const w = await world()
    const added = call(w, 'add_menu_item', { label: 'Volunteers', url: '/volunteers', reason: REASON })
    expect(added.result.menu_now.map((i: any) => i.label)).toEqual(['Home', 'Sign up', 'Volunteers'])
    const renamed = call(w, 'rename_menu_item', { label: 'Volunteers', new_label: 'Get involved', change_id: added.change.id, reason: REASON })
    expect(renamed.result.menu_now[2].label).toBe('Get involved')
    expect(await code(() => call(w, 'add_menu_item', { label: 'Bad', url: 'javascript:alert(1)', reason: REASON }))).toBe('validation_failed')
    createSitePart(w.ctx, 'banner', 'main', 'Banner')
    const b = call(w, 'set_banner', { message: 'Closed on Monday', enabled: true, tone: 'info', reason: REASON })
    expect(b.result.banner_now).toMatchObject({ enabled: true, message: 'Closed on Monday' })
  })
})

describe('after publishing', () => {
  it('lists changes and brings status up to date', async () => {
    const w = await world(PUBLISH_ALL)
    const r = call(w, 'edit_text', { find: 'Join us', replace: 'Come along', path: '/events', reason: REASON })
    expect(call(w, 'list_changes', { status: 'open' }).changes).toHaveLength(1)
    call(w, 'publish_change', { change_id: r.change.id })
    expect(call(w, 'get_change', { change_id: r.change.id }).next_steps[0]).toMatch(/Going live|publishing|Call get_change/i)
    await drain(w)
    const done = call(w, 'get_change', { change_id: r.change.id })
    expect(done.change.status).toBe('published')
    expect(done.decision.outcome).toBe('publish')
    expect(done.next_steps[0]).toMatch(/undo_change/)
    expect(getPage(w.ctx, w.pageId).page.publishedVersionId).toBeTruthy()
  })
})
