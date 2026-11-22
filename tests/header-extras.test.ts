import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HEADER_JS, THEME_CSS, renderPageHtml, styleHash, type RenderedPage, type SiteRenderContext } from '../server/services/render'
import { BUNDLE_ID, OVER_HERO_CSS } from '../shared/theme-css'
import { defaultSitePartDoc, type HeaderDoc, type MenuDoc } from '../shared/site-parts'
import { emptyPageDoc } from '../shared/page'

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

async function render(overrides: Partial<SiteRenderContext> = {}): Promise<RenderedPage> {
  return renderPageHtml({ doc: emptyPageDoc('Home'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(overrides) })
}

function styleOf(html: string): string {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  if (style === undefined) throw new Error('missing style tag')
  return style
}

describe('see-through header', () => {
  it('adds the class, script and scrim CSS only when see-through is on', async () => {
    const on = await render({ header: { id: 'sp_header', doc: header({ overHero: true, appearance: 'dark' }) } })
    expect(on.html).toContain('class="site-header site-header-dark site-header-over"')
    expect(on.html).toContain('<script src="/header.js" defer></script>')
    expect(on.html).not.toMatch(/<header class="[^"]*\bjs-over\b/)
    expect(styleOf(on.html)).toBe(THEME_CSS + OVER_HERO_CSS)
    expect(on.csp).toContain(`style-src 'self' ${styleHash(styleOf(on.html))}`)
    expect(on.csp).toContain("script-src 'self'")
    expect(on.csp).not.toMatch(/script-src 'self' https?:/)
    expect(OVER_HERO_CSS).toContain('linear-gradient(to bottom, rgba(20, 12, 8, 0.6), rgba(20, 12, 8, 0))')
    expect(OVER_HERO_CSS).toContain('text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5)')
    expect(OVER_HERO_CSS).toContain('prefers-reduced-motion: reduce')
    expect(THEME_CSS).not.toContain('site-header-over')
    expect(on.deps.bundleId).toBe(BUNDLE_ID)

    const off = await render()
    expect(off.html).not.toContain('site-header-over')
    expect(off.html).not.toContain('header.js')
    expect(styleOf(off.html)).toBe(THEME_CSS)
    expect(off.csp).toContain(styleHash(THEME_CSS))
  })

  it('renders the same bytes when overHero is false or omitted', async () => {
    const { overHero: _off, ...omitted } = header()
    void _off
    const explicit = await render({ header: { id: 'sp_header', doc: header({ overHero: false }) } })
    const missing = await render({ header: { id: 'sp_header', doc: omitted } })
    expect(explicit.html).toBe(missing.html)
    expect(explicit.csp).toBe(missing.csp)
  })
})

function runHeaderJs(opts: { firstClass: string | null; scrollY?: number; detailsOpen?: boolean; stripBottom?: number | null }) {
  const classes = new Set<string>()
  let strip = ''
  const listeners: { type: string; fn: () => void }[] = []
  const windowListeners: Record<string, () => void> = {}
  const headerEl = {
    classList: {
      add(name: string) { classes.add(name) },
      toggle(name: string, on?: boolean) {
        if (on) classes.add(name)
        else classes.delete(name)
      },
      contains(name: string) { return classes.has(name) },
    },
    style: { setProperty(_name: string, value: string) { strip = value } },
    querySelector(sel: string) {
      if (sel === 'details[open]') return opts.detailsOpen ? {} : null
      return null
    },
    addEventListener(type: string, fn: () => void) { listeners.push({ type, fn }) },
  }
  const banner = opts.stripBottom == null ? null : { getBoundingClientRect: () => ({ bottom: opts.stripBottom }) }
  const sandbox = {
    document: {
      querySelector(sel: string) {
        if (sel === '.site-header-over') return headerEl
        if (sel === 'main > :first-child') return opts.firstClass == null ? null : { className: opts.firstClass }
        if (sel === '.banner') return banner
        return null
      },
    },
    window: {
      scrollY: opts.scrollY ?? 0,
      addEventListener(type: string, fn: () => void) { windowListeners[type] = fn },
    },
  }
  runInNewContext(HEADER_JS, sandbox)
  return {
    classes,
    strip: () => strip,
    setScroll(y: number) {
      sandbox.window.scrollY = y
      windowListeners.scroll?.()
    },
    resize() { windowListeners.resize?.() },
    toggle() { listeners.find((l) => l.type === 'toggle')?.fn() },
    setStrip(bottom: number) { opts.stripBottom = bottom },
  }
}

describe('see-through header script', () => {
  it('floats over a hero and turns solid after scrolling or when a menu is open', () => {
    const view = runHeaderJs({ firstClass: 'hero', stripBottom: 28 })
    expect(view.classes.has('js-over')).toBe(true)
    expect(view.classes.has('is-solid')).toBe(false)
    expect(view.strip()).toBe('28px')

    view.setScroll(41)
    expect(view.classes.has('is-solid')).toBe(true)
    view.setScroll(0)
    expect(view.classes.has('is-solid')).toBe(false)

    view.setStrip(-12)
    view.resize()
    expect(view.strip()).toBe('0px')

    const open = runHeaderJs({ firstClass: 'hero extra', detailsOpen: true, stripBottom: null })
    expect(open.classes.has('js-over')).toBe(true)
    expect(open.classes.has('is-solid')).toBe(true)
    expect(open.strip()).toBe('0px')
  })

  it('stays solid when the first block is not a hero', () => {
    for (const firstClass of ['section', 'vcar', 'hero-inner', null]) {
      const view = runHeaderJs({ firstClass })
      expect(view.classes.has('js-over')).toBe(false)
      expect(view.classes.has('is-solid')).toBe(false)
    }
  })
})
