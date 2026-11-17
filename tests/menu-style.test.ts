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
    expect(classic.html).toContain('>About</summary>')
    expect(classic.html).not.toContain('class="nav nav-hamburger"')
    expect(classic.html).toContain('class="nav"')

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
    expect(burger.html).toContain('nav-hamburger')
    expect(burger.html).toContain('>Menu</summary>')
    expect(burger.html).toContain('>Home</a>')
  })

  it('lets the brand pack override the header look without changing the menu', async () => {
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
    expect(rendered.html).toContain('nav-hamburger')
    expect(rendered.html).not.toContain('site-header-mega')
    expect(rendered.html).toContain('>Home</a>')
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
