import { describe, expect, it } from 'vitest'
import { renderPageHtml, type SiteRenderContext } from '../server/services/render'
import { defaultSitePartDoc, type HeaderDoc, type MenuDoc } from '../shared/site-parts'
import { defaultBrandDoc } from '../shared/brand'
import { emptyPageDoc } from '../shared/page'

function site(overrides: Partial<SiteRenderContext> = {}): SiteRenderContext {
  const menu: MenuDoc = {
    schemaVersion: 1,
    items: [
      { id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] },
      {
        id: 'b_about001',
        label: 'About',
        target: { type: 'url', url: '/about' },
        children: [{ id: 'b_team0001', label: 'Our team', target: { type: 'url', url: '/about/team' } }],
      },
    ],
  }
  const header: HeaderDoc = { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'simple', menuKey: 'main' }
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: { id: 'sp_header', doc: header },
    footer: null,
    banner: null,
    menus: { main: { id: 'sp_menu', doc: menu } },
    pagesById: {},
    media: {},
    embeds: {},
    ...overrides,
  }
}

describe('menu look presets', () => {
  it('renders a classic bar, a mega menu and a hamburger from the same menu tree', async () => {
    const doc = emptyPageDoc('Home')
    const classic = await renderPageHtml({ doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site() })
    expect(classic.html).toContain('class="site-header"')
    expect(classic.html).toContain('>Home</a>')
    expect(classic.html).toContain('>About<svg class="nav-chev"')
    expect(classic.html).toContain('<nav class="nav" aria-label="Site">')
    expect(classic.html.match(/<details class="nav nav-hamburger"/g)).toHaveLength(1)
    expect(classic.html).toContain('<summary aria-label="Menu"><span></span><span></span><span></span></summary>')
    expect(classic.html).toMatch(/<\/nav>(?:<!---->)?<details class="nav nav-hamburger" aria-label="Site"><summary aria-label="Menu"><span><\/span><span><\/span><span><\/span><\/summary>/)

    const mega = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({ header: { id: 'sp_header', doc: { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'mega', menuKey: 'main' } } }),
    })
    expect(mega.html).toContain('site-header-mega')
    expect(mega.html).toContain('nav-mega')
    expect(mega.html).toContain('Our team')

    const burger = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({ header: { id: 'sp_header', doc: { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'hamburger', menuKey: 'main' } } }),
    })
    expect(burger.html).toContain('site-header-hamburger')
    expect(burger.html.match(/<details class="nav nav-hamburger"/g)).toHaveLength(1)
    expect(burger.html).not.toContain('<nav class="nav"')
    expect(burger.html).toContain('<summary aria-label="Menu"><span></span><span></span><span></span></summary>')
    expect(burger.html).toContain('>Home</a>')
  })

  it('uses the look chosen on the header, even when the brand pack still holds an older choice', async () => {
    const doc = emptyPageDoc('Home')
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({
        brand: { ...defaultBrandDoc(), menuStyle: 'hamburger' },
        header: { id: 'sp_header', doc: { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'mega', menuKey: 'main' } },
      }),
    })
    expect(rendered.html).toContain('site-header-mega')
    expect(rendered.html).toContain('<nav class="nav nav-mega" aria-label="Site">')
    expect(rendered.html).toContain('<details class="nav nav-hamburger nav-mega" aria-label="Site">')
    expect(rendered.html).toMatch(/<header class="site-header site-header-mega"/)
    expect(rendered.html).toContain('Our team')
  })

  it("falls back to the brand pack's look only when there is no header", async () => {
    const rendered = await renderPageHtml({
      doc: emptyPageDoc('Home'),
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({ brand: { ...defaultBrandDoc(), menuStyle: 'hamburger' }, header: null }),
    })
    expect(rendered.html).toContain('site-header-hamburger')
  })

  it('falls back to the header style when the site has no brand pack', async () => {
    const doc = emptyPageDoc('Home')
    const rendered = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({
        brand: null,
        header: { id: 'sp_header', doc: { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'centred', menuKey: 'main' } },
      }),
    })
    expect(rendered.html).toContain('site-header-centred')
    expect(rendered.html).toContain('>Home</a>')
  })
})
