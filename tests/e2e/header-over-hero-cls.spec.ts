import { expect, test, type Page } from 'playwright/test'
import { HEADER_JS, renderPageHtml, type MediaCatalogEntry, type SiteRenderContext } from '../../server/services/render'
import { defaultBrandDoc } from '../../shared/brand'
import { defaultSitePartDoc, type BannerDoc, type HeaderDoc, type MenuDoc } from '../../shared/site-parts'
import { emptyPageDoc, type PageDoc } from '../../shared/page'

// Drawn in this process and loaded with setContent. No app server, same reason as header-extras.spec.ts.

const PHOTO = 'med_00000000000000000000000009'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

function photo(): MediaCatalogEntry {
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
  }
}

function pageDoc(kind: 'image' | 'carousel'): PageDoc {
  const image = { media: PHOTO, alt: 'A dog in care' }
  const hero = kind === 'image'
    ? {
        id: 'b_hero0001',
        type: 'Hero',
        v: 1,
        props: { heading: 'Keep them warm', subheading: 'Blankets and food for every kennel.', image },
      }
    : {
        id: 'b_hero0001',
        type: 'Hero',
        v: 1,
        props: {
          mode: 'image-carousel',
          heading: 'Keep them warm',
          subheading: 'Blankets and food for every kennel.',
          slides: [
            { heading: 'Keep them warm', subheading: 'Blankets and food for every kennel.', image },
            { heading: 'Food and treatment', subheading: 'Every kennel.', image },
          ],
        },
      }
  return { ...emptyPageDoc('Home'), blocks: [hero] }
}

function site(bannerOn: boolean): SiteRenderContext {
  const banner: BannerDoc = {
    schemaVersion: 1,
    enabled: true,
    message: 'Urgent: the winter shelter is full tonight and every kennel needs blankets before the storm hits.',
    link: { label: 'Give now', target: { type: 'url', url: 'https://example.org/give' } },
    tone: 'urgent',
  }
  const header: HeaderDoc = {
    ...(defaultSitePartDoc('header') as HeaderDoc),
    style: 'mega',
    menuKey: 'main',
    overHero: true,
    cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } },
  }
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: { id: 'sp_header', doc: header },
    footer: null,
    banner: bannerOn ? { id: 'sp_banner', doc: banner } : null,
    menus: { main: { id: 'sp_menu', doc: menu } },
    pagesById: {},
    media: { [PHOTO]: photo() },
    embeds: {},
    // A real logo. Hero photos are .hero-media, so this img must stay in the bar's flex layout.
    brand: { ...defaultBrandDoc(), logoMediaId: PHOTO },
  }
}

function browserHtml(html: string, script: 'run' | 'omit'): string {
  let out = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
  out = out.replace(/\n\s*<script src="\/hero\.js" defer><\/script>/, '')
  // Keep a scrollbar gutter from the first frame so its arrival is not a layout shift.
  out = out.replace('</head>', '<style>html { overflow-y: scroll; }</style></head>')
  const tag = '<script src="/header.js" defer></script>'
  if (!out.includes(tag)) throw new Error('renderer did not emit /header.js')
  if (script === 'run') return out.replace(tag, `<script>${HEADER_JS}</script>`)
  return out.replace(tag, '')
}

async function readFit(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect()
    const photo = document.querySelector('.hero-media')!.getBoundingClientRect()
    const banner = document.querySelector('.banner')?.getBoundingClientRect() ?? null
    const reserve = document.querySelector('.hero-reserve')?.getBoundingClientRect() ?? null
    const main = document.querySelector('main')!.getBoundingClientRect()
    return {
      headerTop: header.top,
      headerHeight: header.height,
      photoTop: photo.top,
      photoBottom: photo.bottom,
      bannerBottom: banner?.bottom ?? null,
      reserveHeight: reserve?.height ?? null,
      mainTop: main.top,
      heroHeight: document.querySelector('main > .hero')!.getBoundingClientRect().height,
    }
  })
}

test('leading hero keeps CLS under 0.02 for an image and a carousel', async ({ page }) => {
  await page.route('**/media/**', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
  })
  await page.addInitScript(() => {
    const w = window as Window & { __cls?: number }
    w.__cls = 0
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        if (!shift.hadRecentInput) w.__cls = (w.__cls ?? 0) + (shift.value ?? 0)
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })
  })

  const notes: string[] = []
  for (const kind of ['image', 'carousel'] as const) {
    for (const bannerOn of [false, true]) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 375, height: 812 },
      ]) {
        for (const script of ['run', 'omit'] as const) {
          const label = `${kind} banner=${bannerOn} ${viewport.width} ${script}`
          await page.setViewportSize(viewport)
          const rendered = await renderPageHtml({ doc: pageDoc(kind), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(bannerOn) })
          await page.setContent(browserHtml(rendered.html, script), { waitUntil: 'load' })
          await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }))
          const cls = await page.evaluate(() => (window as Window & { __cls?: number }).__cls ?? 0)
          const fit = await readFit(page)
          notes.push(`${label} cls=${cls.toFixed(4)} header=${fit.headerHeight.toFixed(1)} photoTop=${fit.photoTop.toFixed(1)} headerTop=${fit.headerTop.toFixed(1)}`)
          expect(cls, label).toBeLessThan(0.02)
          expect(fit.photoTop, label).toBeLessThanOrEqual(fit.headerTop + 1)
          expect(fit.photoBottom, label).toBeGreaterThanOrEqual(fit.headerTop + fit.headerHeight - 1)
          if (bannerOn) {
            expect(fit.bannerBottom, label).not.toBeNull()
            expect(fit.headerTop, label).toBeGreaterThanOrEqual((fit.bannerBottom ?? 0) - 1)
            expect(Math.abs(fit.photoTop - (fit.bannerBottom ?? 0)), label).toBeLessThanOrEqual(1)
          } else {
            expect(fit.headerTop, label).toBeLessThanOrEqual(1)
            expect(fit.photoTop, label).toBeLessThanOrEqual(1)
          }
          if (kind === 'image') {
            expect(fit.reserveHeight, label).not.toBeNull()
            expect(Math.abs((fit.reserveHeight ?? 0) - fit.headerHeight), label).toBeLessThanOrEqual(1)
          } else {
            expect(fit.reserveHeight, label).toBeNull()
          }
        }
      }
    }
  }

  // Writing the old measurements must not move the bar or the hero.
  await page.setViewportSize({ width: 1280, height: 800 })
  const rendered = await renderPageHtml({ doc: pageDoc('image'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(true) })
  await page.setContent(browserHtml(rendered.html, 'run'), { waitUntil: 'load' })
  const before = await readFit(page)
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--sb-header-h', '400px')
    document.querySelector('header')!.style.setProperty('--strip', '80px')
  })
  expect(await readFit(page)).toEqual(before)
  console.log(notes.join('\n'))
})

test('phone Menu opens from the keyboard without a nested scroll box', async ({ page }) => {
  await page.route('**/media/**', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
  })
  await page.setViewportSize({ width: 375, height: 812 })
  const rendered = await renderPageHtml({ doc: pageDoc('image'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(true) })
  let html = browserHtml(rendered.html, 'run')
  html = html.replace('</head>', '<style>html, body { min-height: 4000px; }</style></head>')
  await page.setContent(html, { waitUntil: 'load' })

  const summary = page.locator('header details.nav-hamburger > summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('header details.nav-hamburger')).toHaveJSProperty('open', true)
  await page.keyboard.press('Tab')
  const landed = await page.evaluate(() => {
    const el = document.activeElement
    return {
      text: el?.textContent ?? '',
      inPanel: !!el?.closest('header .nav-panel'),
      inFooter: !!el?.closest('footer'),
      inReserve: !!el?.closest('.hero-reserve'),
      inDesktopNav: !!el?.closest('header > .site-header-inner > nav'),
    }
  })
  expect(landed).toEqual({ text: 'Home', inPanel: true, inFooter: false, inReserve: false, inDesktopNav: false })
  await page.keyboard.press('Shift+Tab')
  await expect(summary).toBeFocused()

  const open = await page.evaluate(() => {
    const root = document.documentElement
    const panel = document.querySelector('header details.nav-hamburger .nav-panel')
    const header = document.querySelector('header')
    if (!panel || !header) return null
    const panelStyle = getComputedStyle(panel)
    const headerStyle = getComputedStyle(header)
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      panelScroll: panel.scrollHeight - panel.clientHeight,
      panelOverflow: panelStyle.overflowY,
      headerOverflow: headerStyle.overflowY,
      solid: header.classList.contains('is-solid'),
    }
  })
  expect(open?.scrollWidth).toBe(open?.clientWidth)
  expect(open?.panelScroll).toBeLessThanOrEqual(1)
  expect(open?.panelOverflow).not.toBe('auto')
  expect(open?.panelOverflow).not.toBe('scroll')
  expect(open?.headerOverflow).not.toBe('auto')
  expect(open?.headerOverflow).not.toBe('scroll')
  expect(open?.solid).toBe(true)
})
