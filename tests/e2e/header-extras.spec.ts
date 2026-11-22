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

test('see-through header and mega tiles, from renderer HTML, with no sign-in', async ({ page }) => {
  await show(page, 'hero', 'run')
  expect(await headerLook(page)).toEqual({ over: true, jsOver: true, solid: false, fixed: true, gradient: true, paper: false })

  await page.evaluate(() => window.scrollTo(0, 80))
  await expect.poll(() => headerLook(page)).toEqual({ over: true, jsOver: true, solid: true, fixed: true, gradient: false, paper: true })

  const images = page.locator('.nav-mega-tiles img')
  await expect(images).toHaveCount(1)
  await expect(images).toHaveAttribute('loading', 'lazy')
  await expect(images).toHaveAttribute('width', '1200')
  await expect(images).toHaveAttribute('height', '800')

  await page.locator('header summary').click()
  await expect(page.locator('header details')).toHaveJSProperty('open', true)
  await page.locator('header summary').focus()
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

  await show(page, 'hero', 'omit')
  expect(await headerLook(page)).toEqual({ over: true, jsOver: false, solid: false, fixed: false, gradient: false, paper: false })
})
