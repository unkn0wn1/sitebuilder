import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HEADER_JS, THEME_CSS, renderPageHtml, styleHash, type RenderedPage, type SiteRenderContext } from '../server/services/render'
import { defaultBrandDoc } from '../shared/brand'
import { BUNDLE_ID, OVER_HERO_CSS, TILE_CSS, themeCssFromTokens } from '../shared/theme-css'
import type { MediaCatalogEntry } from '../server/services/render'
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
    expect(OVER_HERO_CSS).toContain('.site-header-over.js-over ~ main > .hero:first-child { box-sizing: content-box; padding-top: var(--sb-header-h, 0px); }')
    expect(THEME_CSS).not.toContain('site-header-over')
    expect(THEME_CSS).not.toContain('--sb-header-h')
    expect(THEME_CSS).not.toContain('content-box')
    // No side padding on .hero, so content-box does not change the phone width. The photo is inset 0, so it still covers the bar.
    expect(THEME_CSS).toMatch(/\.hero \{\s*position: relative;\s*min-height: min\(70vh, 36rem\);/)
    expect(THEME_CSS).not.toMatch(/\.hero \{[^}]*padding/)
    expect(THEME_CSS).toMatch(/\.hero-media, \.hero-video, \.hero img \{\s*position: absolute;\s*inset: 0;/)
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
    // The key is absent on purpose: old saves omit it, and that must match an explicit false.
    const missing = await render({ header: { id: 'sp_header', doc: omitted as HeaderDoc } })
    expect(explicit.html).toBe(missing.html)
    expect(explicit.csp).toBe(missing.csp)
  })

  it('appends a see-through override only for a paper or ink that is not the default', async () => {
    const defaults = defaultBrandDoc()
    const headerOn = { id: 'sp_header', doc: header({ overHero: true, appearance: 'dark' }) }
    const stock = await render({ header: headerOn, brand: defaults, themeCss: themeCssFromTokens(defaults.tokens, defaults.fonts) })
    expect(styleOf(stock.html)).toBe(THEME_CSS + OVER_HERO_CSS)
    expect(stock.csp).toContain(styleHash(styleOf(stock.html)))

    const ink = { ...defaults, tokens: { ...defaults.tokens, ink: '#102030' } }
    const inkCss = themeCssFromTokens(ink.tokens, ink.fonts)
    const inkPage = await render({ header: headerOn, brand: ink, themeCss: inkCss })
    const scrim = '\n.site-header-over.js-over { background: linear-gradient(to bottom, color-mix(in srgb, var(--ink) 60%, transparent), color-mix(in srgb, var(--ink) 0%, transparent)); }\n'
    expect(styleOf(inkPage.html)).toBe(inkCss + OVER_HERO_CSS + scrim)
    expect(styleOf(inkPage.html)).toContain('.site-header-dark.site-header-over.js-over:not(.is-solid) .site-title { background: transparent;')
    expect(styleOf(inkPage.html)).not.toContain('.ft-logo { background: var(--paper); }')
    expect(styleOf(inkPage.html)).not.toContain('#112233')
    expect(inkPage.csp).toContain(styleHash(styleOf(inkPage.html)))

    const paper = { ...defaults, tokens: { ...defaults.tokens, paper: '#fff1e0' } }
    const paperCss = themeCssFromTokens(paper.tokens, paper.fonts)
    const paperPage = await render({ header: headerOn, brand: paper, themeCss: paperCss })
    const pill = '\n.site-header-over.js-over:not(.is-solid) .site-title { background: var(--paper); }\n'
    expect(styleOf(paperPage.html)).toBe(paperCss + OVER_HERO_CSS + pill)
    expect(styleOf(paperPage.html)).toContain('background: transparent;')
    expect(paperPage.csp).toContain(styleHash(styleOf(paperPage.html)))

    const accent = { ...defaults, tokens: { ...defaults.tokens, accent: '#113399' } }
    const accentCss = themeCssFromTokens(accent.tokens, accent.fonts)
    const accentPage = await render({ header: headerOn, brand: accent, themeCss: accentCss })
    expect(styleOf(accentPage.html)).toBe(accentCss + OVER_HERO_CSS)
    expect(accentPage.csp).toContain(styleHash(styleOf(accentPage.html)))
  })
})

function runHeaderJs(opts: { firstClass: string | null; scrollY?: number; detailsOpen?: boolean; stripBottom?: number | null; headerHeight?: number }) {
  const classes = new Set<string>()
  let strip = ''
  const rootVars: Record<string, string> = {}
  const metrics = { headerHeight: opts.headerHeight ?? 64 }
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
    getBoundingClientRect() { return { height: metrics.headerHeight, bottom: 0 } },
    querySelector(sel: string) {
      if (sel === 'details[open]') return opts.detailsOpen ? {} : null
      return null
    },
    addEventListener(type: string, fn: () => void) { listeners.push({ type, fn }) },
  }
  const banner = opts.stripBottom == null ? null : { getBoundingClientRect: () => ({ bottom: opts.stripBottom }) }
  const sandbox = {
    document: {
      documentElement: { style: { setProperty(name: string, value: string) { rootVars[name] = value } } },
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
    headerVar: () => rootVars['--sb-header-h'],
    setHeaderHeight(h: number) { metrics.headerHeight = h },
    setScroll(y: number) {
      sandbox.window.scrollY = y
      windowListeners.scroll?.()
    },
    resize() { windowListeners.resize?.() },
    toggle() { listeners.find((l) => l.type === 'toggle')?.fn() },
    setStrip(bottom: number) { opts.stripBottom = bottom },
  }
}

const PHOTO = 'med_00000000000000000000000009'

function photoEntry(overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry {
  return {
    id: PHOTO,
    width: 1200,
    height: 800,
    alt: 'A dog in care',
    decorative: false,
    status: 'ready',
    kind: 'image',
    mime: 'image/jpeg',
    cropRatios: [],
    ...overrides,
  }
}

function child(n: number, extra: { featured?: boolean; image?: { media: string; alt?: string; decorative?: boolean } | undefined } = {}) {
  return {
    id: `b_tile000${n}`,
    label: `Tile ${n}`,
    target: { type: 'url' as const, url: `/tile-${n}` },
    ...extra,
  }
}

describe('mega menu photo tiles', () => {
  it('renders up to five lazy photo tiles after the text links', async () => {
    const items: MenuDoc = {
      schemaVersion: 1,
      items: [
        {
          id: 'b_about001',
          label: 'About',
          target: { type: 'url', url: '/about' },
          children: [
            child(1, { featured: true, image: { media: PHOTO, alt: 'Kennel' } }),
            child(2, { featured: true, image: { media: PHOTO } }),
            child(3, { featured: true, image: { media: PHOTO, decorative: true } }),
            child(4, { featured: true }),
            child(5, { featured: true, image: { media: PHOTO, alt: 'Fifth' } }),
            child(6, { featured: true, image: { media: PHOTO, alt: 'Sixth' } }),
          ],
        },
      ],
    }
    const rendered = await render({
      header: { id: 'sp_header', doc: header({ style: 'mega' }) },
      menus: { main: { id: 'sp_menu', doc: items } },
      media: { [PHOTO]: photoEntry() },
    })
    const panel = rendered.html.match(/<div class="nav-mega-panel nav-mega-panel-tiles">([\s\S]*?)<\/div>/)?.[1] ?? ''
    expect(panel.indexOf('nav-mega-links')).toBeLessThan(panel.indexOf('nav-mega-tiles'))
    expect(panel).toContain('>Tile 6</a>')
    expect(panel.split('class="tile"').length - 1).toBe(4)
    expect(panel.split('class="tile tile-text"').length - 1).toBe(1)
    expect(panel).not.toContain('Alt Sixth')
    expect(panel).not.toContain('>Tile 6</span>')
    const photo = panel.match(/<a class="tile" href="\/tile-1">([\s\S]*?)<\/a>/)?.[1] ?? ''
    expect(photo).toContain('src="/media/med_00000000000000000000000009-640.webp"')
    expect(photo).toContain('srcset="')
    expect(photo).toContain('/media/med_00000000000000000000000009-320.webp 320w')
    expect(photo).toContain('sizes="(max-width: 640px) 45vw, 13rem"')
    expect(photo).not.toContain('100vw')
    expect(photo).toContain('width="1200"')
    expect(photo).toContain('height="800"')
    expect(photo).toContain('loading="lazy"')
    expect(photo).toContain('decoding="async"')
    expect(photo).toContain('alt="Kennel"')
    expect(photo).not.toContain('<picture')
    expect(panel).toContain('alt="A dog in care"')
    // Vue SSR writes an empty alt as a bare attribute. HTML parses that as alt="".
    expect(panel).toMatch(/\salt(?:=\"\"|(?=[\s/>]))/)
    expect(rendered.deps.media).toContain(PHOTO)
    expect(styleOf(rendered.html)).toBe(THEME_CSS + TILE_CSS)
    expect(TILE_CSS).toContain('.tile:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }')
    expect(THEME_CSS).not.toContain('nav-mega-tiles')
    expect(rendered.deps.bundleId).toBe(BUNDLE_ID)
  })

  it('uses a text tile when the photo is missing from the library', async () => {
    const items: MenuDoc = {
      schemaVersion: 1,
      items: [{
        id: 'b_about001',
        label: 'About',
        target: { type: 'url', url: '/about' },
        children: [child(1, { featured: true, image: { media: PHOTO, alt: 'Gone' } })],
      }],
    }
    const rendered = await render({
      header: { id: 'sp_header', doc: header({ style: 'mega' }) },
      menus: { main: { id: 'sp_menu', doc: items } },
      mediaComplete: true,
    })
    expect(rendered.html).toContain('class="tile tile-text"')
    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).not.toContain(PHOTO)
    expect(rendered.deps.media).not.toContain(PHOTO)
  })

  it('shows a placeholder tile in preview when the photo is not in the library', async () => {
    const items: MenuDoc = {
      schemaVersion: 1,
      items: [{
        id: 'b_about001',
        label: 'About',
        target: { type: 'url', url: '/about' },
        children: [child(1, { featured: true, image: { media: PHOTO, alt: 'Gone' } })],
      }],
    }
    const rendered = await render({
      header: { id: 'sp_header', doc: header({ style: 'mega' }) },
      menus: { main: { id: 'sp_menu', doc: items } },
      preview: true,
    })
    expect(rendered.html).toContain('data-sample-photo')
    expect(rendered.html).toContain('width="640"')
    expect(rendered.html).toContain('height="420"')
    expect(rendered.html).toContain('loading="lazy"')
    expect(rendered.html).toContain('decoding="async"')
  })

  it('does not render tiles in other header styles, or when none are featured', async () => {
    const featured: MenuDoc = {
      schemaVersion: 1,
      items: [{
        id: 'b_about001',
        label: 'About',
        target: { type: 'url', url: '/about' },
        children: [child(1, { featured: true, image: { media: PHOTO, alt: 'Kennel' } })],
      }],
    }
    const simple = await render({
      header: { id: 'sp_header', doc: header({ style: 'simple' }) },
      menus: { main: { id: 'sp_menu', doc: featured } },
      media: { [PHOTO]: photoEntry() },
    })
    expect(simple.html).not.toContain('class="tile')
    expect(simple.html).toContain('>Tile 1</a>')
    expect(styleOf(simple.html)).toBe(THEME_CSS)
    expect(simple.deps.media).not.toContain(PHOTO)

    const plain = await render({ header: { id: 'sp_header', doc: header({ style: 'mega' }) } })
    const explicit = await render({
      header: { id: 'sp_header', doc: header({ style: 'mega' }) },
      menus: {
        main: {
          id: 'sp_menu',
          doc: {
            schemaVersion: 1,
            items: [
              { id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] },
              {
                id: 'b_about001',
                label: 'About',
                target: { type: 'url', url: '/about' },
                children: [{ id: 'b_team0001', label: 'Our team', target: { type: 'url', url: '/about/team' }, featured: false }],
              },
            ],
          },
        },
      },
    })
    expect(explicit.html).toBe(plain.html)
    expect(explicit.html).toContain('<ul class="nav-mega-panel">')
    expect(explicit.html).not.toContain('nav-mega-tiles')
  })

  it('renders an svg tile without a raster srcset and skips a video', async () => {
    const items: MenuDoc = {
      schemaVersion: 1,
      items: [{
        id: 'b_about001',
        label: 'About',
        target: { type: 'url', url: '/about' },
        children: [
          child(1, { featured: true, image: { media: PHOTO, alt: 'Mark' } }),
          child(2, { featured: true, image: { media: 'med_0000000000000000000000000A', alt: 'Clip' } }),
        ],
      }],
    }
    const rendered = await render({
      header: { id: 'sp_header', doc: header({ style: 'mega' }) },
      menus: { main: { id: 'sp_menu', doc: items } },
      media: {
        [PHOTO]: photoEntry({ kind: 'svg', mime: 'image/svg+xml', width: 80, height: 40 }),
        med_0000000000000000000000000A: photoEntry({ id: 'med_0000000000000000000000000A', kind: 'video', mime: 'video/mp4' }),
      },
    })
    expect(rendered.html).toContain('src="/media/med_00000000000000000000000009.svg"')
    expect(rendered.html).toContain('width="80"')
    expect(rendered.html).toContain('height="40"')
    expect(rendered.html).not.toContain('srcset=')
    expect(rendered.html).toContain('class="tile tile-text"')
    expect(rendered.html).toContain('>Tile 2</span>')
    expect(rendered.deps.media).toContain(PHOTO)
    expect(rendered.deps.media).not.toContain('med_0000000000000000000000000A')
  })
})

describe('see-through header script', () => {
  it('floats over a hero and turns solid after scrolling or when a menu is open', () => {
    const view = runHeaderJs({ firstClass: 'hero', stripBottom: 28, headerHeight: 73.6 })
    expect(view.classes.has('js-over')).toBe(true)
    expect(view.classes.has('is-solid')).toBe(false)
    expect(view.strip()).toBe('28px')
    expect(view.headerVar()).toBe('74px')

    // Turning solid on scroll does not re-pad the hero (no jump mid-scroll).
    view.setHeaderHeight(64)
    view.setScroll(41)
    expect(view.classes.has('is-solid')).toBe(true)
    expect(view.headerVar()).toBe('74px')
    // Back at the top the transparent bar is measured again (for example after the title wraps).
    view.setHeaderHeight(91)
    view.setScroll(0)
    expect(view.classes.has('is-solid')).toBe(false)
    expect(view.headerVar()).toBe('91px')

    view.setStrip(-12)
    view.resize()
    expect(view.strip()).toBe('0px')
    expect(view.headerVar()).toBe('91px')

    const open = runHeaderJs({ firstClass: 'hero extra', detailsOpen: true, stripBottom: null, headerHeight: 80 })
    expect(open.classes.has('js-over')).toBe(true)
    expect(open.classes.has('is-solid')).toBe(true)
    expect(open.strip()).toBe('0px')
    expect(open.headerVar()).toBe('80px')
  })

  it('stays solid when the first block is not a hero', () => {
    for (const firstClass of ['section', 'vcar', 'hero-inner', null]) {
      const view = runHeaderJs({ firstClass, headerHeight: 80 })
      expect(view.classes.has('js-over')).toBe(false)
      expect(view.classes.has('is-solid')).toBe(false)
      expect(view.headerVar()).toBeUndefined()
    }
  })
})
