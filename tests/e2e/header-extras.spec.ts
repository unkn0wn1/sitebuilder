import { expect, test, type Page } from 'playwright/test'
import { HEADER_JS, renderPageHtml, type MediaCatalogEntry, type SiteRenderContext } from '../../server/services/render'
import { defaultSitePartDoc, type HeaderDoc, type MenuDoc } from '../../shared/site-parts'
import { emptyPageDoc, type PageDoc } from '../../shared/page'
import { richTextFromParagraphs } from '../../shared/richtext'

// Drawn in this process and loaded with setContent. The seeded server allows 10 sign-ins per email
// per 15 minutes, and the other specs already use them, so this file must not open the app at all.

const PHOTO = 'med_00000000000000000000000009'
const PAPER = 'rgb(255, 250, 243)'
const ACCENT = 'rgb(181, 71, 29)'

const menu: MenuDoc = {
  schemaVersion: 1,
  items: [
    { id: 'b_home0001', label: 'Home', target: { type: 'url', url: '/' }, children: [] },
    {
      id: 'b_about001',
      label: 'About',
      target: { type: 'url', url: '/about' },
      children: [
        { id: 'b_tile0001', label: 'Kennel', target: { type: 'url', url: '/kennel' }, featured: true, image: { media: PHOTO, alt: 'Kennel' } },
        { id: 'b_tile0002', label: 'Plain', target: { type: 'url', url: '/plain' }, featured: true },
        { id: 'b_team0001', label: 'Our team', target: { type: 'url', url: '/about/team' } },
      ],
    },
  ],
}

function headerDoc(): HeaderDoc {
  return {
    ...(defaultSitePartDoc('header') as HeaderDoc),
    style: 'mega',
    menuKey: 'main',
    overHero: true,
    cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' } },
  }
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

function pageDoc(first: 'hero' | 'section'): PageDoc {
  const hero = {
    id: 'b_hero0001',
    type: 'Hero',
    v: 1,
    props: { heading: 'Keep them warm', subheading: 'Blankets and food.', image: { media: PHOTO, alt: 'A dog in care' } },
  }
  const story = {
    id: 'b_text0001',
    type: 'RichText',
    v: 1,
    props: { content: richTextFromParagraphs(['A story that does not open with a photo.']) },
  }
  return { ...emptyPageDoc('Home'), blocks: first === 'hero' ? [hero, story] : [story, hero] }
}

function site(): SiteRenderContext {
  return {
    name: 'Example charity',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: { id: 'sp_header', doc: headerDoc() },
    footer: null,
    banner: null,
    menus: { main: { id: 'sp_menu', doc: menu } },
    pagesById: {},
    media: { [PHOTO]: photo() },
    embeds: {},
  }
}

/** The publish renderer points at /header.js. This document has no server, so the real script is inlined and the page CSP (script-src 'self') is left out. */
function browserHtml(html: string, script: 'run' | 'omit'): string {
  let out = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
  out = out.replace('</head>', '<style>html, body { min-height: 4000px; }</style></head>')
  const tag = '<script src="/header.js" defer></script>'
  if (!out.includes(tag)) throw new Error('renderer did not emit /header.js')
  if (script === 'run') return out.replace(tag, `<script>${HEADER_JS}</script>`)
  return out.replace(tag, '')
}

async function show(page: Page, first: 'hero' | 'section', script: 'run' | 'omit') {
  const rendered = await renderPageHtml({ doc: pageDoc(first), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site() })
  expect(rendered.html).toContain('site-header-over')
  expect(rendered.html).toContain('.tile:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }')
  await page.setContent(browserHtml(rendered.html, script), { waitUntil: 'load' })
}

async function headerLook(page: Page) {
  return page.evaluate((paper) => {
    const el = document.querySelector('header')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      over: el.classList.contains('site-header-over'),
      jsOver: el.classList.contains('js-over'),
      solid: el.classList.contains('is-solid'),
      fixed: style.position === 'fixed',
      gradient: style.backgroundImage.includes('linear-gradient'),
      paper: style.backgroundColor === paper,
    }
  }, PAPER)
}

/** Heading stays below the fixed bar, the photo still covers that bar, and the text stays inside the phone width. */
async function heroFit(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')
    const hero = document.querySelector('main > .hero')
    const h1 = hero?.querySelector('h1')
    const photo = hero?.querySelector('.hero-media')
    const inner = hero?.querySelector('.hero-inner')
    if (!header || !hero || !h1 || !photo || !inner) return null
    const hb = header.getBoundingClientRect()
    const h1b = h1.getBoundingClientRect()
    const pb = photo.getBoundingClientRect()
    const ib = inner.getBoundingClientRect()
    const heroBox = hero.getBoundingClientRect()
    const cs = getComputedStyle(hero)
    const padTop = parseFloat(cs.paddingTop)
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const minH = Math.min(window.innerHeight * 0.7, 36 * root)
    const contentH = heroBox.height - padTop - parseFloat(cs.paddingBottom)
    const vw = document.documentElement.clientWidth
    return {
      boxSizing: cs.boxSizing,
      padLeft: cs.paddingLeft,
      padRight: cs.paddingRight,
      padMatchesHeader: Math.abs(padTop - Math.round(hb.height)) <= 0.5,
      h1Clears: h1b.top >= hb.bottom - 0.5,
      photoCoversHeader: pb.top <= hb.top + 0.5 && pb.bottom >= hb.bottom - 0.5 && pb.left <= heroBox.left + 1 && pb.right >= heroBox.right - 1,
      innerInside: ib.left >= -0.5 && ib.right <= vw + 0.5 && ib.width < vw,
      contentKeepsMinHeight: contentH + 1 >= minH,
    }
  })
}

const HERO_FIT = {
  boxSizing: 'content-box',
  padLeft: '0px',
  padRight: '0px',
  padMatchesHeader: true,
  h1Clears: true,
  photoCoversHeader: true,
  innerInside: true,
  contentKeepsMinHeight: true,
}

async function heroPad(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector('main .hero')
    if (!hero) return null
    const cs = getComputedStyle(hero)
    return { padTop: cs.paddingTop, boxSizing: cs.boxSizing }
  })
}

test('see-through header and mega tiles, from renderer HTML, with no sign-in', async ({ page }) => {
  await show(page, 'hero', 'run')
  expect(await headerLook(page)).toEqual({ over: true, jsOver: true, solid: false, fixed: true, gradient: true, paper: false })
  await expect(page.locator('header > .site-header-inner > nav a').first()).toHaveCSS('font-weight', '600')
  expect(await heroFit(page)).toEqual(HERO_FIT)

  await page.setViewportSize({ width: 390, height: 800 })
  await expect.poll(() => heroFit(page)).toEqual(HERO_FIT)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(() => heroFit(page)).toEqual(HERO_FIT)

  // Turning solid on scroll keeps the hero padding as it was, so nothing jumps mid-scroll.
  const padAtTop = (await heroPad(page))?.padTop
  await page.evaluate(() => window.scrollTo(0, 80))
  await expect.poll(() => headerLook(page)).toEqual({ over: true, jsOver: true, solid: true, fixed: true, gradient: false, paper: true })
  await expect(page.locator('header > .site-header-inner > nav a').first()).toHaveCSS('font-weight', '500')
  expect((await heroPad(page))?.padTop).toBe(padAtTop)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => heroFit(page)).toEqual(HERO_FIT)
  await page.evaluate(() => window.scrollTo(0, 80))
  await expect.poll(() => headerLook(page)).toEqual({ over: true, jsOver: true, solid: true, fixed: true, gradient: false, paper: true })

  const images = page.locator('header nav .nav-mega-tiles img')
  await expect(images).toHaveCount(1)
  await expect(images).toHaveAttribute('loading', 'lazy')
  await expect(images).toHaveAttribute('width', '1200')
  await expect(images).toHaveAttribute('height', '800')

  const about = page.locator('header nav details')
  await about.locator('summary').click()
  await expect(about).toHaveJSProperty('open', true)
  await about.locator('summary').focus()
  const order: { href: string | null; tile: boolean }[] = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    const current = await page.evaluate(() => {
      const el = document.activeElement
      return { href: el?.getAttribute('href') ?? null, tile: !!el?.classList.contains('tile') }
    })
    order.push(current)
    if (current.tile) {
      await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid')
      await expect(page.locator(':focus')).toHaveCSS('outline-width', '3px')
      await expect(page.locator(':focus')).toHaveCSS('outline-color', ACCENT)
      await expect(page.locator(':focus')).toHaveCSS('outline-offset', '2px')
    }
  }
  expect(order).toEqual([
    { href: '/kennel', tile: false },
    { href: '/plain', tile: false },
    { href: '/about/team', tile: false },
    { href: '/kennel', tile: true },
    { href: '/plain', tile: true },
  ])

  await show(page, 'section', 'run')
  expect(await headerLook(page)).toEqual({ over: true, jsOver: false, solid: false, fixed: false, gradient: false, paper: false })
  expect(await heroPad(page)).toEqual({ padTop: '0px', boxSizing: 'border-box' })

  await show(page, 'hero', 'omit')
  expect(await headerLook(page)).toEqual({ over: true, jsOver: false, solid: false, fixed: false, gradient: false, paper: false })
  expect(await heroPad(page)).toEqual({ padTop: '0px', boxSizing: 'border-box' })
})

test('simple, centred and mega headers collapse to Menu and Donate on a phone', async ({ page }) => {
  for (const style of ['simple', 'centred', 'mega'] as const) {
    const ctx = site()
    ctx.header = {
      id: 'sp_header',
      doc: { ...headerDoc(), style, overHero: true },
    }
    const rendered = await renderPageHtml({ doc: pageDoc('hero'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: ctx })
    await page.setViewportSize({ width: 390, height: 800 })
    await page.setContent(browserHtml(rendered.html, 'run'), { waitUntil: 'load' })

    await expect(page.locator('header > .site-header-inner > nav')).toHaveCSS('display', 'none')
    const summary = page.locator('header details.nav-hamburger > summary')
    await expect(summary).toBeVisible()
    await expect(summary).toHaveText('Menu')
    await expect(page.getByRole('link', { name: 'Donate', exact: true })).toBeVisible()
    if (style === 'centred') await expect(page.locator('.site-header-inner')).toHaveCSS('flex-direction', 'row')

    const menu = page.locator('header details.nav-hamburger')
    await menu.locator('> summary').click()
    await expect(menu).toHaveJSProperty('open', true)
    const panel = menu.locator('.nav-panel')
    await expect(panel.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await panel.locator('summary', { hasText: 'About' }).click()
    await expect(panel.getByRole('link', { name: 'Our team', exact: true })).toBeVisible()

    const open = await page.evaluate(() => {
      const root = document.documentElement
      const panelEl = document.querySelector('header details.nav-hamburger .nav-panel')
      const header = document.querySelector('header')
      if (!panelEl || !header) return null
      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        panelScroll: panelEl.scrollHeight - panelEl.clientHeight,
        overflowY: getComputedStyle(panelEl).overflowY,
        solid: header.classList.contains('is-solid'),
        position: getComputedStyle(header).position,
      }
    })
    expect(open?.scrollWidth).toBe(open?.clientWidth)
    expect(open?.panelScroll).toBeLessThanOrEqual(1)
    expect(open?.overflowY).not.toBe('auto')
    expect(open?.overflowY).not.toBe('scroll')
    expect(open?.solid).toBe(true)
    expect(open?.position).not.toBe('fixed')

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(menu).toHaveCSS('display', 'none')
    await expect(page.locator('header > .site-header-inner > nav')).toBeVisible()
    await expect(page.locator('header summary').first()).toHaveText('About')
  }
})

test('hamburger utility link is shown once, in the drawer on a phone and in the bar on a desktop', async ({ page }) => {
  const ctx = site()
  ctx.header = {
    id: 'sp_header',
    doc: {
      ...(defaultSitePartDoc('header') as HeaderDoc),
      style: 'hamburger',
      menuKey: 'main',
      utility: { label: 'Report an animal', target: { type: 'url', url: 'https://example.org/report' } },
    },
  }
  const rendered = await renderPageHtml({ doc: emptyPageDoc('Home'), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: ctx })
  expect(rendered.html).toContain('class="util util-drawer"')
  expect(rendered.html).toContain('class="util util-bar"')
  expect(rendered.html).not.toContain('header.js')
  await page.setContent(rendered.html, { waitUntil: 'load' })

  const shown = () => page.evaluate(() => [...document.querySelectorAll('a.util')].flatMap((el) => {
    const style = getComputedStyle(el)
    return style.display === 'none' || style.visibility === 'hidden' ? [] : [el.className]
  }))

  await page.setViewportSize({ width: 390, height: 800 })
  await page.locator('header details.nav-hamburger > summary').click()
  await expect(page.locator('header details.nav-hamburger')).toHaveJSProperty('open', true)
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveClass('util util-drawer')
  await expect(page.locator('.util-bar')).toHaveCSS('display', 'none')
  expect(await shown()).toEqual(['util util-drawer'])

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveClass('util util-bar')
  await expect(page.locator('.nav-panel .util-drawer')).toHaveCSS('display', 'none')
  expect(await shown()).toEqual(['util util-bar'])

  await page.locator('header details.nav-hamburger > summary').click()
  await expect(page.locator('header details.nav-hamburger')).toHaveJSProperty('open', false)
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Report an animal' })).toHaveClass('util util-bar')
  expect(await shown()).toEqual(['util util-bar'])
})
