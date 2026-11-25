import { describe, expect, it } from 'vitest'
import { renderSitePartPreview } from '../server/services/draft-preview'
import { runJobsOnce } from '../server/services/jobs'
import { createPage } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { approveReview, submitPage } from '../server/services/reviews'
import { addSitePart, createSitePart, requireSitePart } from '../server/services/site-parts'
import { renderPageHtml } from '../server/services/render'
import { defaultSitePartDoc, type BannerDoc, type FooterDoc, type HeaderDoc, type MenuDoc } from '../shared/site-parts'
import { emptyPageDoc } from '../shared/page'
import { AppError } from '../server/services/errors'
import { setup } from './helpers'

const handlers = { publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }
const STRIP: BannerDoc = {
  schemaVersion: 1,
  enabled: true,
  message: 'Report an ill or injured animal in Udaipur',
  link: { label: 'Get help', target: { type: 'url', url: 'https://www.animalaidunlimited.org/report-an-animal/' } },
  tone: 'info',
}
const menu = (label: string): MenuDoc => ({ schemaVersion: 1, items: [{ id: 'b_item0001', label, target: { type: 'url', url: '/' }, children: [] }] })

async function liveSite() {
  const s = setup()
  const header = createSitePart(s.ctx, 'header', 'header', 'Header', s.admin, { live: true })
  const main = createSitePart(s.ctx, 'menu', 'main', 'Main menu', s.admin, { live: true })
  const banner = createSitePart(s.ctx, 'banner', 'main', 'Site banner', s.admin, { live: true })
  const spare = createSitePart(s.ctx, 'menu', 'spare', 'Spare menu', s.admin)
  const { page } = createPage(s.ctx, s.editor, { title: 'Home', template: 'standard', slug: 'home' })
  const sub = submitPage(s.ctx, s.editor, page.id)
  approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
  await runJobsOnce(s.ctx, handlers)
  return { s, header, main, banner, spare, pageId: page.id }
}

describe('the top strip (banner) on the header screen', () => {
  it('previews the draft strip and header together on a live page', async () => {
    const { s, header, banner, pageId } = await liveSite()
    const headerDoc: HeaderDoc = { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'mega', menuKey: 'main' }
    const out = await renderSitePartPreview(s.ctx, { parts: [{ partId: header, doc: headerDoc }, { partId: banner, doc: STRIP }] })
    expect(out.page?.id).toBe(pageId)
    expect(out.html).toContain('class="banner banner-info"')
    expect(out.html).toContain('Report an ill or injured animal in Udaipur')
    expect(out.html).toContain('href="https://www.animalaidunlimited.org/report-an-animal/">Get help</a>')
    expect(out.html).toContain('site-header-mega')
  })

  it('draws nothing for a strip that is switched off', async () => {
    const { s, banner } = await liveSite()
    const out = await renderSitePartPreview(s.ctx, { parts: [{ partId: banner, doc: { ...STRIP, enabled: false } }] })
    expect(out.html).not.toContain('class="banner ')
  })

  it('turns down a strip that is on but has no message', async () => {
    const { s, banner } = await liveSite()
    await expect(renderSitePartPreview(s.ctx, { parts: [{ partId: banner, doc: { ...STRIP, message: '' } }] })).rejects.toBeInstanceOf(AppError)
  })

  it('publishes the strip exactly as before (the header screen only moves where it is edited)', async () => {
    const site = {
      name: 'Hope for Street Animals',
      origin: 'https://example.org',
      titlePattern: '{page} | {site}',
      allowIndexing: true,
      defaultSocialImage: null,
      tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
      header: null,
      footer: null,
      banner: { id: 'sp_banner', doc: STRIP },
      menus: {},
      pagesById: {},
      media: {},
      embeds: {},
    }
    const { html } = await renderPageHtml({ doc: emptyPageDoc('Home'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site })
    // The exact banner markup expected by live sites.
    expect(html).toContain('<div class="banner banner-info" role="status">Report an ill or injured animal in Udaipur<!--[--> <a href="https://www.animalaidunlimited.org/report-an-animal/">Get help</a><!--]--></div>')
  })

  it('can be added from the header screen, starting switched off and not live', async () => {
    const s = setup()
    const { id, key } = addSitePart(s.ctx, s.admin, { kind: 'banner', label: 'Top strip' })
    expect(key).toBe('main')
    const part = requireSitePart(s.ctx, id)
    expect(part.publishedVersionId).toBeNull()
    expect(() => addSitePart(s.ctx, s.editor, { kind: 'banner', label: 'Another' })).toThrow(/approvers and admins/)
  })
})

describe('menus: one picker on the header, and a real preview', () => {
  it('says where a menu is used, and shows a menu nothing uses yet in the header', async () => {
    const { s, main, spare } = await liveSite()
    const used = await renderSitePartPreview(s.ctx, { parts: [{ partId: main, doc: menu('Adopt a dog') }] })
    expect(used.menuUse).toBe('header')
    expect(used.html).toContain('Adopt a dog')
    const unused = await renderSitePartPreview(s.ctx, { parts: [{ partId: spare, doc: menu('Volunteer') }] })
    expect(unused.menuUse).toBe('unused')
    expect(unused.html).toContain('Volunteer')
  })

  it('shows a columns footer links menu in the footer and still reports the header menu as the header', async () => {
    const { s, main, spare } = await liveSite()
    const footer = createSitePart(s.ctx, 'footer', 'footer', 'Footer', s.admin, { live: true })
    const footerDoc: FooterDoc = { ...(defaultSitePartDoc('footer') as FooterDoc), layout: 'columns', linksMenuKey: 'spare' }
    const links = await renderSitePartPreview(s.ctx, {
      parts: [
        { partId: footer, doc: footerDoc },
        { partId: spare, doc: menu('Our work') },
      ],
    })
    expect(links.menuUse).toBe('footer')
    const column = links.html.match(/<nav class="ft-links"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(column).toContain('Our work')
    const headerNav = links.html.match(/<(?:nav|details) class="nav[^"]*"[^>]*>([\s\S]*?)<\/(?:nav|details)>/)?.[1] ?? ''
    expect(headerNav).not.toContain('Our work')
    const headerMenu = await renderSitePartPreview(s.ctx, { parts: [{ partId: main, doc: menu('Adopt a dog') }] })
    expect(headerMenu.menuUse).toBe('header')
    expect(headerMenu.html).toContain('Adopt a dog')
    expect(headerMenu.html).not.toContain('ft-links')
  })

  it('draws the menu the header picks, in the look the header picks', async () => {
    const { s, header, spare } = await liveSite()
    const { html } = await renderSitePartPreview(s.ctx, {
      parts: [
        { partId: header, doc: { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'hamburger', menuKey: 'spare' } },
        { partId: spare, doc: menu('Volunteer') },
      ],
    })
    expect(html).toContain('class="nav nav-hamburger"')
    expect(html).toContain('Volunteer')
  })

  it('names a new menu from its label and never reuses a key', () => {
    const s = setup()
    createSitePart(s.ctx, 'menu', 'main', 'Main menu', s.admin)
    expect(addSitePart(s.ctx, s.admin, { kind: 'menu', label: 'Footer links' }).key).toBe('footer-links')
    expect(addSitePart(s.ctx, s.admin, { kind: 'menu', label: 'Footer links' }).key).toBe('footer-links-2')
    expect(addSitePart(s.ctx, s.admin, { kind: 'menu', label: 'Main' }).key).toBe('main-2')
  })
})
