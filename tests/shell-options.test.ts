import { describe, expect, it } from 'vitest'
import { emptyPageDoc } from '../shared/page'
import { richTextFromParagraphs } from '../shared/richtext'
import { BANNER_ACCENT_CSS, FOOTER_COLUMNS_CSS, HEART_CSS, UTILITY_CSS } from '../shared/theme-css'
import { defaultSitePartDoc, validateSitePartDoc, type BannerDoc, type FooterDoc, type HeaderDoc, type HeaderStyle, type MenuDoc } from '../shared/site-parts'
import { THEME_CSS, renderPageHtml, styleHash, type RenderedPage, type SiteRenderContext } from '../server/services/render'

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

function header(overrides: Partial<HeaderDoc> = {}): HeaderDoc {
  return { ...(defaultSitePartDoc('header') as HeaderDoc), style: 'simple', menuKey: 'main', cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } }, ...overrides }
}

function site(overrides: Partial<SiteRenderContext> = {}): SiteRenderContext {
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: { id: 'sp_header', doc: header() },
    footer: null,
    banner: null,
    menus: { main: { id: 'sp_menu', doc: menu } },
    pagesById: {},
    media: {},
    embeds: {},
    ...overrides,
  }
}

async function render(overrides: Partial<SiteRenderContext> = {}, blocks: ReturnType<typeof emptyPageDoc>['blocks'] = []): Promise<RenderedPage> {
  const doc = emptyPageDoc('Home')
  doc.blocks = blocks
  return renderPageHtml({ doc, pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(overrides) })
}

function styleOf(html: string): string {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  if (style === undefined) throw new Error('missing style tag')
  return style
}

function expectFullCss(rendered: RenderedPage, extra: string) {
  const style = styleOf(rendered.html)
  expect(style).toBe(THEME_CSS + extra)
  const hash = styleHash(style)
  expect(rendered.csp).toContain(`style-src 'self' ${hash}`)
  expect(rendered.html).toContain(`<style>${style}</style>`)
  expect(rendered.html).toContain(hash)
}

describe('optional shell parts', () => {
  it('puts one utility link in the nav for simple, centred and mega, on light and dark', async () => {
    const utility = { label: 'Report an animal', target: { type: 'url' as const, url: 'https://example.org/report' } }
    for (const style of ['simple', 'centred', 'mega'] as HeaderStyle[]) {
      for (const appearance of ['light', 'dark'] as const) {
        const rendered = await render({ header: { id: 'sp_header', doc: header({ style, appearance, utility }) } })
        expect(rendered.html.split('class="util"').length - 1).toBe(1)
        const navClass = style === 'mega' ? 'nav nav-mega' : 'nav'
        expect(rendered.html).toMatch(new RegExp(`<nav class="${navClass}" aria-label="Site">[\\s\\S]*class="util" href="https://example.org/report">Report an animal</a>[\\s\\S]*</nav>`))
        const markup = rendered.html.replace(/<style>[\s\S]*?<\/style>/, '')
        expect(markup).not.toContain('class="nav-panel"')
        expect(markup).not.toContain('nav-hamburger')
        expectFullCss(rendered, UTILITY_CSS)
      }
    }
    const off = await render()
    expect(off.html).not.toContain('class="util"')
    expect(styleOf(off.html)).toBe(THEME_CSS)
  })

  it('puts the utility link in the hamburger menu and beside the Menu button', async () => {
    const rendered = await render({
      header: {
        id: 'sp_header',
        doc: header({
          style: 'hamburger',
          utility: { label: 'Report an animal', target: { type: 'page', pageId: 'pg_about' } },
        }),
      },
      pagesById: { pg_about: { path: '/about-us', title: 'About' } },
    })
    expect(rendered.html.split('class="util"').length - 1).toBe(2)
    const panel = rendered.html.match(/<div class="nav-panel">([\s\S]*?)<\/div>/)?.[1]
    expect(panel).toContain('class="util" href="/about-us">Report an animal</a>')
    const bar = rendered.html.match(/<div class="site-header-inner">([\s\S]*?)<\/header>/)?.[1].replace(/<div class="nav-panel">[\s\S]*?<\/div>/, '')
    expect(bar).toContain('class="util" href="/about-us">Report an animal</a>')
    expect(rendered.deps.linkedPageIds).toContain('pg_about')
    expectFullCss(rendered, UTILITY_CSS)
  })

  it('draws a heart on the header button only when the icon is set, and hashes the full CSS', async () => {
    const heart = await render({ header: { id: 'sp_header', doc: header({ cta: { label: 'Donate', icon: 'heart', target: { type: 'url', url: 'https://example.org/donate' } } }) } })
    expect(heart.html).toContain('class="ico-heart"')
    expect(heart.html).toContain('<span>Donate</span>')
    expect(heart.html).toContain('class="cta-btn"')
    expectFullCss(heart, HEART_CSS)
    expect(heart.csp).not.toContain(styleHash(THEME_CSS))

    const plain = await render()
    expect(plain.html).not.toContain('ico-heart')
    expect(plain.html).toContain('class="cta-btn" href="https://example.org/donate">Donate</a>')
    expect(styleOf(plain.html)).toBe(THEME_CSS)

    const doc = emptyPageDoc('Home')
    doc.blocks = [{ id: 'b_cta0001', type: 'CallToAction', v: 1, props: { heading: 'Help them', tone: 'accent', icon: 'heart', button: { label: 'Give', href: '/give' } } }]
    const block = await renderPageHtml({
      doc,
      pageId: 'pg_home',
      versionId: 'ver_1',
      path: '/',
      site: site({ header: null, menus: {}, banner: { id: 'sp_banner', doc: { ...(defaultSitePartDoc('banner') as BannerDoc), enabled: true, message: 'Open', link: { label: 'Read', icon: 'heart', target: { type: 'url', url: 'https://example.org/read' } }, tone: 'info' } } }),
    })
    expect(block.html).toContain('>Give</a>')
    expect(block.html).toContain('>Read</a>')
    expect(block.html).not.toContain('ico-heart')
    expect(styleOf(block.html)).toBe(THEME_CSS)
    expect(block.csp).toContain(styleHash(THEME_CSS))
  })

  it('uses the brand theme plus the option CSS, and the CSP hash covers both', async () => {
    const themeCss = THEME_CSS.replace('--accent: #b5471d;', '--accent: #113399;')
    const rendered = await render({
      themeCss,
      header: { id: 'sp_header', doc: header({ cta: { label: 'Donate', icon: 'heart', target: { type: 'url', url: 'https://example.org/donate' } } }) },
    })
    const style = styleOf(rendered.html)
    expect(style).toBe(themeCss + HEART_CSS)
    expect(rendered.csp).toContain(styleHash(style))
    expect(styleHash(style)).not.toBe(styleHash(THEME_CSS))
  })

  it('renders a columns footer with tagline, contact, links menu, legal text and social icons', async () => {
    const links: MenuDoc = { schemaVersion: 1, items: [{ id: 'b_link0001', label: 'Our work', target: { type: 'url', url: '/work' }, children: [] }] }
    const legal: MenuDoc = { schemaVersion: 1, items: [{ id: 'b_priv0001', label: 'Privacy', target: { type: 'url', url: '/privacy' }, children: [] }] }
    const parsed = validateSitePartDoc('footer', {
      schemaVersion: 1,
      layout: 'columns',
      appearance: 'dark',
      text: richTextFromParagraphs(['We help street animals.']),
      contact: { email: 'hello@example.org', phone: '+44 20 7946 0000', address: '1 High Street' },
      social: [
        { network: 'facebook', url: 'https://facebook.com/example' },
        { network: 'instagram', url: 'https://instagram.com/example' },
      ],
      tagline: { lead: 'For the animals', accent: 'every day' },
      linksTitle: 'More',
      linksMenuKey: 'footer-links',
      legalMenuKey: 'legal',
      legalText: 'Registered charity.',
      charityNumber: '1234567',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = await render({
      header: null,
      menus: { 'footer-links': { id: 'sp_links', doc: links }, legal: { id: 'sp_legal', doc: legal } },
      footer: { id: 'sp_footer', doc: parsed.doc },
    })
    expect(rendered.html).toContain('site-footer site-footer-cols site-footer-dark')
    expect(rendered.html).toContain('For the animals')
    expect(rendered.html).toContain('<em>every day</em>')
    expect(rendered.html).toContain('>More</h3>')
    expect(rendered.html).toContain('ft-links')
    expect(rendered.html).toContain('>Our work')
    expect(rendered.html).toContain('ico-arrow')
    expect(rendered.html).toContain('mailto:hello@example.org')
    expect(rendered.html).toContain('tel:+442079460000')
    expect(rendered.html).toContain('1 High Street')
    const address = rendered.html.match(/<address>[\s\S]*?<\/address>/)?.[0] ?? ''
    expect(address).not.toContain('1 High Street')
    expect(rendered.html).toContain('<p>1 High Street</p>')
    expect(rendered.html).toContain('Registered charity.')
    expect(rendered.html).toContain('Charity number 1234567.')
    expect(rendered.html).toContain('aria-label="Facebook"')
    expect(rendered.html).toContain('aria-label="Instagram"')
    expect(rendered.html).toContain('ico-social')
    expect(rendered.deps.siteParts).toEqual(expect.arrayContaining(['sp_footer', 'sp_links', 'sp_legal']))
    expectFullCss(rendered, FOOTER_COLUMNS_CSS)
    expect(rendered.html).not.toContain(UTILITY_CSS.trim())
    expect(rendered.html).not.toContain('ico-heart')
    expect(rendered.html).not.toContain('banner-accent')

    const untitled = validateSitePartDoc('footer', {
      schemaVersion: 1,
      layout: 'columns',
      appearance: 'light',
      contact: { email: 'hello@example.org', phone: null, address: null },
      linksMenuKey: 'footer-links',
    })
    if (!untitled.ok) throw new Error('footer')
    const light = await render({
      header: null,
      menus: { 'footer-links': { id: 'sp_links', doc: links } },
      footer: { id: 'sp_footer', doc: untitled.doc },
    })
    expect(light.html).toContain('class="site-footer site-footer-cols"')
    expect(light.html).not.toMatch(/class="[^"]*site-footer-dark/)
    expect(light.html).toContain('>Get in touch</h3>')
    expect(light.html).toContain('>Find out more</h3>')
    expect(light.html).not.toContain('Charity number')
  })

  it('renders an accent banner only when the strip is on, with a matching CSP hash', async () => {
    const accent = validateSitePartDoc('banner', { schemaVersion: 1, enabled: true, message: 'Give today', tone: 'accent', link: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } } })
    if (!accent.ok) throw new Error('banner')
    const rendered = await render({ header: null, menus: {}, banner: { id: 'sp_banner', doc: accent.doc } })
    expect(rendered.html).toContain('class="banner banner-accent"')
    expect(rendered.html).toContain('role="status"')
    expect(rendered.html).toContain('Give today')
    expect(rendered.html).toContain('>Donate</a>')
    expectFullCss(rendered, BANNER_ACCENT_CSS)
    expect(rendered.html).not.toContain('ico-heart')
    expect(rendered.html).not.toContain('site-footer-cols')

    const off = validateSitePartDoc('banner', { schemaVersion: 1, enabled: false, message: 'Give today', tone: 'accent' })
    if (!off.ok) throw new Error('off')
    const hidden = await render({ header: null, menus: {}, banner: { id: 'sp_banner', doc: off.doc } })
    expect(hidden.html).not.toContain('banner-accent')
    expect(styleOf(hidden.html)).toBe(THEME_CSS)
    expect(hidden.csp).toContain(styleHash(THEME_CSS))
  })
})
