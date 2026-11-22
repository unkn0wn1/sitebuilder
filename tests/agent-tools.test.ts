import { describe, expect, it } from 'vitest'
import { evaluateTargets, type ChangeTarget } from '../server/services/agent/changes'
import { callOperation } from '../server/services/agent/operations'
import { AppError } from '../server/services/errors'
import { applyPageOps, createPage, getPage, readDoc, requirePage, restoreVersion } from '../server/services/pages'
import { authenticateAgent, enableAlwaysAllow } from '../server/services/agent/tokens'
import { approveReview, submitPage } from '../server/services/reviews'
import { createSitePart, editSitePart, requireSitePart, submitSitePart } from '../server/services/site-parts'
import { richTextToMarkdown } from '../shared/agent/content'
import { richTextFromParagraphs } from '../shared/richtext'
import { IMG } from './helpers'
import { PASSWORD_FOR_TESTS, PUBLISH_ALL, SIGNUP, code, drain, world, type World } from './agent-helpers'

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
    expect(r.personality).toContain('Write in plain English, with British spelling.')
    expect(r.personality).not.toContain('<!--')
    expect(r.never_list.sections_that_cannot_be_touched).toEqual(['DonationEmbed', 'Embed'])
    expect(r.never_list.also).toContain('Raw HTML, scripts, tracking')
    expect(r.never_list.also.join(' ')).not.toContain('Raw HTML, CSS')
    expect(r.never_list.also.join(' ')).toContain('set_block_css')
    expect(r.never_list.also.join(' ')).toContain('Site-wide CSS has no agent tool')
    expect(r.actions.edit_css).toBe('Change custom CSS on a section. Always needs a person.')
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
    expect(byPath.sections.every((s: any) => s.custom_css === false && s.css === undefined)).toBe(true)
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
    // The edit reply is brief; the full diff is in get_change.
    expect(r.change.targets[0].text_changes).toBeUndefined()
    expect(r.change.targets.every((t: any) => typeof t.summary === 'string')).toBe(true)
    const full = call(w, 'get_change', { change_id: r.change.id })
    expect(full.change.targets[0].text_changes.length + full.change.targets[1].text_changes.length).toBeGreaterThan(0)
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(full).length)
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

  it('sets an accent banner with a heart link and keeps fields a later call does not mention', async () => {
    const w = await world()
    createSitePart(w.ctx, 'banner', 'main', 'Banner')
    const b = call(w, 'set_banner', { enabled: true, message: 'Give today', tone: 'accent', link: { label: 'Donate', url: 'https://example.org/donate', icon: 'heart' }, reason: REASON })
    expect(b.result.banner_now).toMatchObject({ enabled: true, tone: 'accent', link: { label: 'Donate', icon: 'heart', target: { type: 'url', url: 'https://example.org/donate' } } })
    const later = call(w, 'set_banner', { message: 'Give this week', change_id: b.change.id, reason: REASON })
    expect(later.result.banner_now).toMatchObject({ message: 'Give this week', tone: 'accent', enabled: true, link: { icon: 'heart', label: 'Donate' } })
  })

  it('keeps photo tiles when a menu child is renamed, a sibling is added, or another item is removed', async () => {
    const w = await world()
    const part = requireSitePart(w.ctx, w.menuId)
    editSitePart(w.ctx, w.admin, w.menuId, part.draftRevision, {
      schemaVersion: 1,
      items: [
        { id: 'b_menu0001', label: 'Home', target: { type: 'url', url: '/' }, children: [{ id: 'b_tile0001', label: 'Kennel', target: { type: 'url', url: '/kennel' }, featured: true, image: { media: IMG.media, alt: 'Kennel' } }] },
        { id: 'b_menu0002', label: 'Sign up', target: { type: 'url', url: SIGNUP }, children: [] },
      ],
    })
    const renamed = call(w, 'rename_menu_item', { item_id: 'b_tile0001', new_label: 'The kennel', reason: REASON })
    expect(renamed.result.menu_now[0].children[0]).toMatchObject({ label: 'The kennel', featured: true, image: { media: IMG.media, alt: 'Kennel' } })
    const added = call(w, 'add_menu_item', { label: 'Clinic', url: '/clinic', parent_item_id: 'b_menu0001', change_id: renamed.change.id, reason: REASON })
    expect(added.result.menu_now[0].children[0]).toMatchObject({ featured: true, image: { alt: 'Kennel' } })
    expect(added.result.menu_now[0].children).toHaveLength(2)
    call(w, 'remove_menu_item', { label: 'Sign up', change_id: renamed.change.id, reason: REASON })
    const doc = call(w, 'get_site_part', { kind: 'menu' }).document
    expect(doc.items.map((i: { label: string }) => i.label)).toEqual(['Home'])
    expect(doc.items[0].children[0]).toMatchObject({ label: 'The kennel', featured: true, image: { media: IMG.media, alt: 'Kennel' } })
  })

  it('returns header utility, the heart icon and overHero in the document', async () => {
    const w = await world()
    const id = createSitePart(w.ctx, 'header', 'main', 'Header')
    editSitePart(w.ctx, w.admin, id, 0, {
      schemaVersion: 1,
      overHero: true,
      utility: { label: 'Report', target: { type: 'url', url: '/report' } },
      cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' }, icon: 'heart' },
    })
    expect(call(w, 'get_site_part', { kind: 'header' }).document).toMatchObject({
      overHero: true,
      utility: { label: 'Report', target: { type: 'url', url: '/report' } },
      cta: { label: 'Donate', icon: 'heart' },
    })
  })

  it('sets and clears a mega-menu photo tile, and refuses a sixth, a bad photo, the wrong menu and a top-level item', async () => {
    const child = (n: number, extra: Record<string, unknown> = {}) => ({ id: `b_tile${String(n).padStart(4, '0')}`, label: `Tile ${n}`, target: { type: 'url', url: `/tile-${n}` }, ...extra })
    const menuOf = (w: World) => {
      const part = requireSitePart(w.ctx, w.menuId)
      editSitePart(w.ctx, w.admin, w.menuId, part.draftRevision, {
        schemaVersion: 1,
        items: [
          { id: 'b_menu0001', label: 'Home', target: { type: 'url', url: '/' }, children: [child(1), child(2)] },
          { id: 'b_menu0002', label: 'Sign up', target: { type: 'url', url: SIGNUP }, children: [] },
        ],
      })
    }
    const header = async (w: World, style: string, menuKey = 'main') => {
      const id = createSitePart(w.ctx, 'header', 'main', 'Header')
      editSitePart(w.ctx, w.admin, id, 0, { schemaVersion: 1, style, menuKey })
      const sub = submitSitePart(w.ctx, w.admin, id)
      approveReview(w.ctx, w.approver, sub.reviewId, { versionId: sub.versionId })
      await drain(w)
      return id
    }
    const restyle = (w: World, id: string, style: string, menuKey = 'main') => {
      const part = requireSitePart(w.ctx, id)
      editSitePart(w.ctx, w.admin, id, part.draftRevision, { schemaVersion: 1, style, menuKey })
    }
    const message = async (fn: () => unknown) => {
      try {
        await fn()
      } catch (e) {
        if (e instanceof AppError) return `${e.code}: ${e.message}`
        throw e
      }
      return 'ok'
    }

    const w = await world()
    menuOf(w)
    // Live header stays simple. Tiles follow the draft, which is mega.
    const headerId = await header(w, 'simple')
    restyle(w, headerId, 'mega')
    const set = call(w, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, image: { media_id: IMG.media, alt: 'A kennel in the yard.' }, reason: REASON })
    expect(set.result.menu_now[0].children[0]).toEqual({ item_id: 'b_tile0001', label: 'Tile 1', featured: true, image: { media: IMG.media, alt: 'A kennel in the yard.' } })
    expect(set.result.menu_now[0].children[1]).toEqual({ item_id: 'b_tile0002', label: 'Tile 2' })
    const kept = call(w, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: false, change_id: set.change.id, reason: REASON })
    expect(kept.result.menu_now[0].children[0]).toEqual({ item_id: 'b_tile0001', label: 'Tile 1', image: { media: IMG.media, alt: 'A kennel in the yard.' } })
    const cleared = call(w, 'set_menu_item_tile', { item_id: 'b_tile0001', image: null, change_id: set.change.id, reason: REASON })
    expect(cleared.result.menu_now[0].children[0]).toEqual({ item_id: 'b_tile0001', label: 'Tile 1' })
    // A video is not a photo: refused, and the tile is left as it was.
    expect(await message(() => call(w, 'set_menu_item_tile', { item_id: 'b_tile0002', featured: true, image: { media_id: 'med_00000000000000000000000002', decorative: true }, change_id: set.change.id, reason: REASON }))).toMatch(/photo, not a video/)
    expect(call(w, 'get_site_part', { kind: 'menu' }).document.items[0].children[1]).toEqual(expect.not.objectContaining({ image: expect.anything() }))

    const full = await world()
    const part = requireSitePart(full.ctx, full.menuId)
    editSitePart(full.ctx, full.admin, full.menuId, part.draftRevision, {
      schemaVersion: 1,
      items: [{ id: 'b_menu0001', label: 'Home', target: { type: 'url', url: '/' }, children: [1, 2, 3, 4, 5, 6].map((n) => child(n, n < 6 ? { featured: true, image: { media: IMG.media, alt: 'Kennel' } } : {})) }],
    })
    await header(full, 'mega')
    const before = call(full, 'get_site_part', { kind: 'menu' }).document
    expect(await message(() => call(full, 'set_menu_item_tile', { item_id: 'b_tile0006', featured: true, reason: REASON }))).toMatch(/Feature at most 5/)
    expect(call(full, 'get_site_part', { kind: 'menu' }).document).toEqual(before)
    expect(call(full, 'list_changes', {}).changes).toHaveLength(0)

    const plain = await world()
    menuOf(plain)
    const plainId = await header(plain, 'simple')
    const plainBefore = call(plain, 'get_site_part', { kind: 'menu' }).document
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/mega/)
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/simple/)
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/"main"/)
    restyle(plain, plainId, 'hamburger')
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/hamburger/)
    restyle(plain, plainId, 'mega', 'primary')
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/mega/)
    expect(await message(() => call(plain, 'set_menu_item_tile', { menu_key: 'main', item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/"primary"/)
    restyle(plain, plainId, 'mega', 'main')
    expect(await message(() => call(plain, 'set_menu_item_tile', { label: 'Home', featured: true, reason: REASON }))).toMatch(/top-level/)
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', image: { media_id: IMG.media }, reason: REASON }))).toMatch(/validation_failed/)
    expect(await message(() => call(plain, 'set_menu_item_tile', { item_id: 'b_tile0001', image: { media_id: 'med_0000000000000000000000000Z', alt: 'Missing' }, reason: REASON }))).toMatch(/not_found/)
    expect(call(plain, 'get_site_part', { kind: 'menu' }).document).toEqual(plainBefore)
    expect(call(plain, 'list_changes', {}).changes).toHaveLength(0)

    const bare = await world()
    expect(await message(() => call(bare, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toMatch(/no header/i)

    const denied = await world([{ label: 'No menu', actions: ['edit_menu'], result: 'deny' }])
    menuOf(denied)
    await header(denied, 'mega')
    expect(await code(() => call(denied, 'set_menu_item_tile', { item_id: 'b_tile0001', featured: true, reason: REASON }))).toBe('rule_denied')
    expect(call(denied, 'get_site_part', { kind: 'menu' }).document.items[0].children[0].featured).toBeUndefined()
    expect(call(denied, 'list_changes', {}).changes).toHaveLength(0)
  })
})

describe('custom CSS', () => {
  const SHEET = 'a { text-underline-offset: 0.15em; }'
  const REASON_CSS = 'Custom CSS always needs a person to review it.'
  const asSections = (w: World): ChangeTarget => {
    const page = requirePage(w.ctx, w.pageId)
    return { type: 'page', id: page.id, label: page.title, path: page.path, actions: ['edit_sections'], revision: page.draftRevision, foreignDraft: false, opIds: [] }
  }
  const judge = (w: World) => evaluateTargets(w.ctx, w.agent.token, [asSections(w)])
  async function publishDraft(w: World) {
    const sub = submitPage(w.ctx, w.editor, w.pageId)
    approveReview(w.ctx, w.admin, sub.reviewId, { versionId: sub.versionId })
    await drain(w)
  }
  async function thrown(fn: () => unknown): Promise<AppError> {
    try {
      await fn()
    } catch (e) {
      if (e instanceof AppError) return e
      throw e
    }
    throw new Error('expected an error')
  }

  it('writes the author text on the draft and still needs a person under a publish-all rule', async () => {
    const w = await world(PUBLISH_ALL)
    const hero = blockOf(w, 'Hero')
    const r = call(w, 'set_block_css', { path: '/events', block_id: hero.id, css: SHEET, reason: REASON })
    expect(blockOf(w, 'Hero').css).toBe(SHEET)
    expect(r.change.targets[0].actions).toEqual(['edit_css'])
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.if_you_publish.reasons[0]).toBe(`${REASON_CSS} (the page "Events" (/events))`)
    const page = call(w, 'get_page', { path: '/events' })
    expect(page.sections.find((s: any) => s.block_id === hero.id)).toMatchObject({ custom_css: true, css: SHEET })
    expect(page.sections.find((s: any) => s.type === 'RichText')).toMatchObject({ custom_css: false })
    expect(page.sections.find((s: any) => s.type === 'RichText').css).toBeUndefined()
    const later = call(w, 'edit_component', { path: '/events', block_id: hero.id, props: { heading: 'Events this winter' }, change_id: r.change.id, reason: REASON })
    expect(later.change.targets[0].actions).toEqual(['edit_css', 'edit_sections'])
    expect(later.if_you_publish.outcome).toBe('goes_to_review')
    const sent = call(w, 'publish_change', { change_id: r.change.id })
    expect(sent.result).toMatchObject({ published: false, sent_for_review: true })
    expect(sent.change.status).toBe('review')
    const live = readDoc(w.ctx, requirePage(w.ctx, w.pageId).publishedVersionId!)
    expect(live.blocks.find((b) => b.id === hero.id)?.css).toBeUndefined()
  })

  it('clears CSS with blank text and still needs a person because the action is edit_css', async () => {
    const w = await world(PUBLISH_ALL)
    const hero = blockOf(w, 'Hero')
    const set = call(w, 'set_block_css', { path: '/events', block_id: hero.id, css: SHEET, reason: REASON })
    const cleared = call(w, 'set_block_css', { path: '/events', block_id: hero.id, css: '  \n  ', change_id: set.change.id, reason: REASON })
    expect(blockOf(w, 'Hero').css).toBeUndefined()
    expect(cleared.result.custom_css).toBe(false)
    expect(cleared.if_you_publish.outcome).toBe('goes_to_review')
    expect(cleared.if_you_publish.reasons).toEqual([REASON_CSS])
    const page = call(w, 'get_page', { path: '/events' })
    expect(page.sections.find((s: any) => s.block_id === hero.id).custom_css).toBe(false)
  })

  it('rejects a missing section and hostile CSS without saving it or echoing the input', async () => {
    const w = await world(PUBLISH_ALL)
    const hero = blockOf(w, 'Hero')
    const before = JSON.stringify(draftDoc(w))
    expect(await code(() => call(w, 'set_block_css', { path: '/events', block_id: 'b_missing01', css: SHEET, reason: REASON }))).toBe('not_found')
    const hostile = 'a { background: url(javascript:MARKER9f3c) }'
    const err = await thrown(() => call(w, 'set_block_css', { path: '/events', block_id: hero.id, css: hostile, reason: REASON }))
    expect(err.code).toBe('validation_failed')
    expect(err.message).toMatch(/^Line \d+, column \d+:/)
    expect(JSON.stringify(err)).not.toContain('MARKER9f3c')
    expect(JSON.stringify(draftDoc(w))).toBe(before)
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('rejects a css key on edit_component and does not change the block', async () => {
    const w = await world()
    const hero = blockOf(w, 'Hero')
    const before = JSON.stringify(draftDoc(w))
    const inProps = await thrown(() => call(w, 'edit_component', { path: '/events', block_id: hero.id, props: { css: SHEET }, reason: REASON }))
    expect(inProps.code).toBe('validation_failed')
    expect(inProps.message).toMatch(/set_block_css/)
    const inUnset = await thrown(() => call(w, 'edit_component', { path: '/events', block_id: hero.id, props: {}, unset: ['css'], reason: REASON }))
    expect(inUnset.code).toBe('validation_failed')
    expect(inUnset.message).toMatch(/set_block_css/)
    expect(JSON.stringify(draftDoc(w))).toBe(before)
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('refuses a deny rule before writing a draft', async () => {
    const w = await world([{ label: 'No CSS', actions: ['edit_css'], result: 'deny' }])
    const hero = blockOf(w, 'Hero')
    const before = JSON.stringify(draftDoc(w))
    expect(await code(() => call(w, 'set_block_css', { path: '/events', block_id: hero.id, css: SHEET, reason: REASON }))).toBe('rule_denied')
    expect(JSON.stringify(draftDoc(w))).toBe(before)
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('flags a CSS text change even when the recorded action is edit_sections', async () => {
    const changed = await world(PUBLISH_ALL)
    const hero = blockOf(changed, 'Hero')
    applyPageOps(changed.ctx, changed.admin, changed.pageId, requirePage(changed.ctx, changed.pageId).draftRevision, [{ op: 'set_block_css', blockId: hero.id, css: SHEET }])
    const changedEv = judge(changed)
    expect(changedEv.targets[0]!.facts.actions).toEqual(['edit_sections'])
    expect(changedEv.targets[0]!.facts.floor).toEqual(['custom_css'])
    expect(changedEv.decision.outcome).toBe('review')
    expect(changedEv.decision.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)

    applyPageOps(changed.ctx, changed.admin, changed.pageId, requirePage(changed.ctx, changed.pageId).draftRevision, [{ op: 'set_block_css', blockId: hero.id, css: '' }])
    applyPageOps(changed.ctx, changed.admin, changed.pageId, requirePage(changed.ctx, changed.pageId).draftRevision, [{ op: 'add_block', block: { type: 'Quote', props: changed.ctx.registry.get('Quote')!.sample, css: SHEET } }])
    const added = judge(changed)
    expect(added.targets[0]!.facts.floor).toContain('custom_css')
    expect(added.decision.outcome).toBe('review')

    const cleared = await world(PUBLISH_ALL)
    const liveHero = blockOf(cleared, 'Hero')
    applyPageOps(cleared.ctx, cleared.admin, cleared.pageId, requirePage(cleared.ctx, cleared.pageId).draftRevision, [{ op: 'set_block_css', blockId: liveHero.id, css: SHEET }])
    await publishDraft(cleared)
    applyPageOps(cleared.ctx, cleared.admin, cleared.pageId, requirePage(cleared.ctx, cleared.pageId).draftRevision, [{ op: 'set_block_css', blockId: liveHero.id, css: '' }])
    const clearedEv = judge(cleared)
    expect(clearedEv.targets[0]!.facts.floor).toEqual(['custom_css'])
    expect(clearedEv.decision.outcome).toBe('review')
  })

  const SECTIONS = [{ label: 'Sections', actions: ['edit_sections'], result: 'publish' }]

  async function publishCss(w: World) {
    const hero = blockOf(w, 'Hero')
    applyPageOps(w.ctx, w.admin, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'set_block_css', blockId: hero.id, css: SHEET }])
    await publishDraft(w)
    return hero.id
  }

  it('sends removal of a section that has CSS to review under an edit_sections publish rule', async () => {
    const w = await world(SECTIONS)
    const heroId = await publishCss(w)
    const r = call(w, 'remove_component', { path: '/events', block_id: heroId, reason: REASON })
    expect(r.change.targets[0].actions).toEqual(['edit_sections'])
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.if_you_publish.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)
    const ev = judge(w)
    expect(ev.targets[0]!.facts.actions).toEqual(['edit_sections'])
    expect(ev.targets[0]!.facts.floor).toContain('custom_css')
    expect(ev.decision.outcome).toBe('review')
    const sent = call(w, 'publish_change', { change_id: r.change.id })
    expect(sent.result).toMatchObject({ published: false, sent_for_review: true })
    expect(sent.change.status).toBe('review')
    const live = readDoc(w.ctx, requirePage(w.ctx, w.pageId).publishedVersionId!)
    expect(live.blocks.find((b) => b.id === heroId)?.css).toBe(SHEET)
  })

  it('sends removal of a section that has CSS to review under always-allow', async () => {
    const w = await world([])
    await publishCss(w)
    enableAlwaysAllow(w.ctx, w.admin, w.tokenId, { permanent: true, siteName: 'Test charity', password: PASSWORD_FOR_TESTS })
    w.agent = authenticateAgent(w.ctx, w.secret, null)
    const heroId = blockOf(w, 'Hero').id
    const r = call(w, 'remove_component', { path: '/events', block_id: heroId, reason: REASON })
    expect(r.if_you_publish.outcome).toBe('goes_to_review')
    expect(r.if_you_publish.always_allow).toBe(false)
    expect(r.if_you_publish.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)
    const ev = judge(w)
    expect(ev.targets[0]!.facts.floor).toContain('custom_css')
    expect(ev.decision.outcome).toBe('review')
    expect(ev.decision.viaAlwaysAllow).toBe(false)
  })

  it('sends removal of a section that has CSS to review under a publish rule for every action', async () => {
    const w = await world(PUBLISH_ALL)
    const heroId = await publishCss(w)
    applyPageOps(w.ctx, w.admin, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'remove_block', blockId: heroId }])
    const ev = judge(w)
    expect(ev.targets[0]!.facts.actions).toEqual(['edit_sections'])
    expect(ev.targets[0]!.facts.floor).toContain('custom_css')
    expect(ev.decision.outcome).toBe('review')
    expect(ev.decision.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)
  })

  it('still auto-publishes removal of a section that has no CSS under an edit_sections publish rule', async () => {
    const w = await world(SECTIONS)
    const richId = blockOf(w, 'RichText').id
    const r = call(w, 'remove_component', { path: '/events', block_id: richId, reason: REASON })
    expect(r.if_you_publish.outcome).toBe('goes_live')
    const ev = judge(w)
    expect(ev.targets[0]!.facts.floor).not.toContain('custom_css')
    expect(ev.decision.outcome).toBe('publish')
  })

  it('lets a deny rule refuse removal of a section that has CSS before a draft is written', async () => {
    const w = await world([{ label: 'No sections', actions: ['edit_sections'], result: 'deny' }, { label: 'Everything', actions: '*', result: 'publish' }])
    const heroId = await publishCss(w)
    const before = JSON.stringify(draftDoc(w))
    expect(await code(() => call(w, 'remove_component', { path: '/events', block_id: heroId, reason: REASON }))).toBe('rule_denied')
    expect(JSON.stringify(draftDoc(w))).toBe(before)
    expect(call(w, 'list_changes', {}).changes).toHaveLength(0)
  })

  it('treats a page restore that drops a CSS section as a CSS change, including for undo', async () => {
    const w = await world(PUBLISH_ALL)
    const beforeId = requirePage(w.ctx, w.pageId).publishedVersionId!
    applyPageOps(w.ctx, w.admin, w.pageId, requirePage(w.ctx, w.pageId).draftRevision, [{ op: 'add_block', block: { type: 'Quote', props: w.ctx.registry.get('Quote')!.sample, css: SHEET } }])
    await publishDraft(w)
    restoreVersion(w.ctx, w.admin, w.pageId, beforeId)
    const ev = evaluateTargets(w.ctx, w.agent.token, [asSections(w)], { actions: ['undo_change'] })
    expect(ev.targets[0]!.facts.actions).toEqual(['undo_change'])
    expect(ev.targets[0]!.facts.floor).toContain('custom_css')
    expect(ev.decision.outcome).toBe('review')
    expect(ev.decision.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)
  })

  it('sends an undo that removes a section added with CSS to review', async () => {
    const { approveWholeChange } = await import('../server/services/agent/admin')
    const w = await world([{ label: 'Sections and undo', actions: ['edit_sections', 'undo_change'], result: 'publish' }])
    const add = call(w, 'add_component', { path: '/events', type: 'Quote', props: w.ctx.registry.get('Quote')!.sample, reason: REASON })
    const quoteId = add.result.sections_now.find((s: { type: string }) => s.type === 'Quote').block_id as string
    const set = call(w, 'set_block_css', { path: '/events', block_id: quoteId, css: SHEET, change_id: add.change.id, reason: REASON })
    expect(set.if_you_publish.outcome).toBe('goes_to_review')
    const sent = call(w, 'publish_change', { change_id: add.change.id })
    expect(sent.result.sent_for_review).toBe(true)
    w.setSelfApproval(true)
    approveWholeChange(w.ctx, w.admin, add.change.id)
    await drain(w)
    const published = call(w, 'get_change', { change_id: add.change.id })
    expect(published.change.status).toBe('published')
    const u = call(w, 'undo_change', { change_id: add.change.id, reason: REASON })
    expect(u.result.undo_goes_live).toBe(false)
    expect(u.result.undo_sent_for_review).toBe(true)
    expect(u.decision.reasons[0]).toMatch(/^Custom CSS always needs a person to review it\./)
    const live = readDoc(w.ctx, requirePage(w.ctx, w.pageId).publishedVersionId!)
    expect(live.blocks.find((b) => b.id === quoteId)?.css).toBe(SHEET)
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
