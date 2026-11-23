import { expect, test, type Page } from 'playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { HEADER_JS, renderPageHtml, type MediaCatalogEntry, type SiteRenderContext } from '../../server/services/render'
import { defaultBrandDoc } from '../../shared/brand'
import { defaultSitePartDoc, type BannerDoc, type HeaderDoc, type MenuDoc } from '../../shared/site-parts'
import { emptyPageDoc, type PageDoc } from '../../shared/page'

// Menu A check shots. setContent only. Photos are the option files, served in place of /media.

const shots = '/workspace/briefs/together-redesign/grok-shots'
const imgDir = '/workspace/briefs/together-redesign/options/img'
const PAPER = 'rgb(255, 250, 243)'
const ACCENT = 'rgb(181, 71, 29)'
const MESSAGE = 'Report an ill or injured animal in Udaipur'

const LOGO = 'logo'
const HERO = 'hero'

type Tile = { id: string; label: string; image: string }

function child(id: string, label: string, image?: string) {
  return {
    id,
    label,
    target: { type: 'url' as const, url: `/${id}` },
    ...(image ? { featured: true as const, image: { media: image, alt: label } } : {}),
  }
}

function group(id: string, label: string, links: string[], tiles: Tile[]) {
  const featured = new Set(tiles.map((tile) => tile.label))
  const children = [
    ...tiles.map((tile) => child(tile.id, tile.label, tile.image)),
    ...links.filter((label) => !featured.has(label)).map((label, index) => child(`${id}t${index}`, label)),
  ]
  return { id, label, target: { type: 'url' as const, url: `/${id}` }, children }
}

const menu: MenuDoc = {
  schemaVersion: 1,
  items: [
    group('b_aboutus', 'About us', ['Our values and mission', 'History of AAU', 'Meet the team', 'FAQs', 'Financial information'], [
      { id: 'b_avalues', label: 'Our values and mission', image: 'm-c2' },
      { id: 'b_ahistory', label: 'History of AAU', image: 'm-g1' },
      { id: 'b_ateam', label: 'Meet the team', image: 'm-g5' },
    ]),
    group('b_whatwedo', 'What we do', ['Rescue', 'Hospital and medical care', 'Street dog sterilization and rabies vaccination program', 'Sanctuary', 'Outreach and education', 'Cruelty response'], [
      { id: 'b_wwrescue', label: 'Rescue', image: 'm-c1' },
      { id: 'b_wwhosp', label: 'Hospital and medical care', image: 'm-g4' },
      { id: 'b_wwsteril', label: 'Street dog sterilization and rabies vaccination program', image: 'm-g2' },
      { id: 'b_wwsanct', label: 'Sanctuary', image: 'm-c3' },
      { id: 'b_wwoutre', label: 'Outreach and education', image: 'm-g3' },
    ]),
    group('b_howtohelp', 'How to help', ['Donate', 'Volunteer', 'Sponsor', 'Adopt', 'Shop Animal Aid', 'Memorialize a pet', 'Create a legacy', 'Donate stock or cryptocurrency'], [
      { id: 'b_htdonate', label: 'Donate', image: 'm-c4' },
      { id: 'b_htvol', label: 'Volunteer', image: 'm-g5' },
      { id: 'b_htspons', label: 'Sponsor', image: 'm-c5' },
      { id: 'b_htadopt', label: 'Adopt', image: 'm-c2' },
      { id: 'b_htmemo', label: 'Memorialize a pet', image: 'm-c6' },
    ]),
    group('b_contact1', 'Contact', ['Plan your visit', 'Careers'], [
      { id: 'b_ctvisit', label: 'Plan your visit', image: 'm-g3' },
      { id: 'b_ctcareer', label: 'Careers', image: 'm-g5' },
    ]),
    { id: 'b_success1', label: 'Success stories', target: { type: 'url', url: '/stories' }, children: [] },
    group('b_unleashed', 'Unlimited Unleashed', ['Building Unlimited Unleashed', 'Your questions answered', 'First look at our new home', 'The difference it will make', 'Make your gift go twice as far'], [
      { id: 'b_unbuild', label: 'Building Unlimited Unleashed', image: 'm-c3' },
      { id: 'b_unques', label: 'Your questions answered', image: 'm-c2' },
      { id: 'b_unlook', label: 'First look at our new home', image: 'm-c6' },
      { id: 'b_undiff', label: 'The difference it will make', image: 'm-g4' },
      { id: 'b_ungift', label: 'Make your gift go twice as far', image: 'm-c5' },
    ]),
  ],
}

function entry(id: string, width: number, height: number): MediaCatalogEntry {
  return { id, width, height, alt: id, decorative: false, status: 'ready', kind: 'image', mime: 'image/webp', cropRatios: [] }
}

function banner(on: boolean): { id: string; doc: BannerDoc } | null {
  if (!on) return null
  return {
    id: 'sp_banner',
    doc: {
      schemaVersion: 1,
      enabled: true,
      message: MESSAGE,
      link: { label: 'Get help', target: { type: 'url', url: 'https://example.org/help' } },
      tone: 'urgent',
    },
  }
}

function site(withBanner: boolean): SiteRenderContext {
  const media: SiteRenderContext['media'] = {
    [LOGO]: entry(LOGO, 320, 97),
    [HERO]: entry(HERO, 1280, 720),
  }
  for (const id of ['m-c1', 'm-c2', 'm-c3', 'm-c4', 'm-c5', 'm-c6', 'm-g1', 'm-g2', 'm-g3', 'm-g4', 'm-g5']) {
    media[id] = entry(id, 640, 420)
  }
  const headerDoc: HeaderDoc = {
    ...(defaultSitePartDoc('header') as HeaderDoc),
    style: 'mega',
    menuKey: 'main',
    overHero: true,
    cta: { label: 'Donate', target: { type: 'url', url: 'https://example.org/donate' }, icon: 'heart' },
  }
  return {
    name: 'Animal Aid Unlimited',
    origin: 'https://example.org',
    titlePattern: '{page} | {site}',
    allowIndexing: true,
    defaultSocialImage: null,
    tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
    header: { id: 'sp_header', doc: headerDoc },
    footer: null,
    banner: banner(withBanner),
    menus: { main: { id: 'sp_menu', doc: menu } },
    pagesById: {},
    media,
    embeds: {},
    brand: { ...defaultBrandDoc(), logoMediaId: LOGO },
  }
}

function pageDoc(): PageDoc {
  return {
    ...emptyPageDoc('Home'),
    blocks: [{
      id: 'b_hero0001',
      type: 'Hero',
      v: 1,
      props: {
        heading: 'Petey has so much love to give',
        subheading: 'A rescued puppy, nursed back to health.',
        image: { media: HERO, alt: 'Petey, a rescued puppy, with a carer' },
      },
    }],
  }
}

function browserHtml(html: string): string {
  return html
    .replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
    .replace('<script src="/header.js" defer></script>', `<script>${HEADER_JS}</script>`)
}

function dataUrl(file: string): string {
  return `data:image/webp;base64,${readFileSync(file).toString('base64')}`
}

const photoData: Record<string, string> = {
  logo: dataUrl(`${imgDir}/logo.webp`),
  hero: dataUrl(`${imgDir}/m-c1.webp`),
}
for (const id of ['m-c1', 'm-c2', 'm-c3', 'm-c4', 'm-c5', 'm-c6', 'm-g1', 'm-g2', 'm-g3', 'm-g4', 'm-g5']) {
  photoData[id] = dataUrl(`${imgDir}/${id}.webp`)
}

async function show(page: Page, width: number, height: number, withBanner = true) {
  await page.setViewportSize({ width, height })
  const rendered = await renderPageHtml({ doc: pageDoc(), pageId: 'pg_home', versionId: 'ver_1', path: '/', site: site(withBanner) })
  await page.setContent(browserHtml(rendered.html), { waitUntil: 'domcontentloaded' })
  const painted = await page.evaluate(async (sources) => {
    document.querySelectorAll('source').forEach((node) => node.remove())
    const jobs: Promise<string>[] = []
    document.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? ''
      const key = Object.keys(sources).find((id) => src.includes(`/media/${id}`))
      const next = key ? sources[key] : ''
      if (!next) return
      img.loading = 'eager'
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      const hidden = !!img.closest('details:not([open])')
      if (hidden) {
        img.src = next
        return
      }
      jobs.push(new Promise((resolve) => {
        const done = (state: string) => resolve(`${key}:${state}`)
        img.addEventListener('load', () => done(String((img as HTMLImageElement).naturalWidth)), { once: true })
        img.addEventListener('error', () => done('error'), { once: true })
        img.src = next
      }))
    })
    return Promise.all(jobs)
  }, photoData)
  if (painted.some((item) => item.endsWith(':error') || item.endsWith(':0'))) {
    throw new Error(`photos failed: ${painted.join(' ')}`)
  }
}

async function rowBand(page: Page) {
  return page.evaluate(() => {
    const logo = document.querySelector('header > .site-header-inner > .site-title')
    const link = document.querySelector('header > .site-header-inner > nav > a, header > .site-header-inner > nav > details > summary')
    const donate = document.querySelector('header > .site-header-inner > .cta-btn')
    if (!logo || !link || !donate) return null
    const tops = [logo, link, donate].map((el) => el.getBoundingClientRect().top)
    const bottoms = [logo, link, donate].map((el) => el.getBoundingClientRect().bottom)
    return {
      band: Math.max(...tops) - Math.min(...tops),
      overlap: Math.min(...bottoms) - Math.max(...tops),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }
  })
}

test('Menu A bar, panel and phone drawer match the closed and open shots', async ({ page }) => {
  test.setTimeout(120_000)
  mkdirSync(shots, { recursive: true })

  await show(page, 1280, 1000)
  const desktopClosed = await rowBand(page)
  const closedGap = await page.evaluate(() => {
    const logo = document.querySelector('header .site-title')!.getBoundingClientRect()
    const link = document.querySelector('header > .site-header-inner > nav > a, header > .site-header-inner > nav > details > summary')!.getBoundingClientRect()
    const header = document.querySelector('header')!.getBoundingClientRect()
    return { gapAfterLogo: link.left - logo.right, barH: header.height, logoW: logo.width }
  })
  console.log('T4 desktop-1280 closed', JSON.stringify({ ...desktopClosed, ...closedGap }))
  expect(desktopClosed!.band).toBeLessThanOrEqual(12)
  expect(desktopClosed!.overlap).toBeGreaterThan(0)
  expect(desktopClosed!.scrollWidth).toBe(desktopClosed!.clientWidth)
  expect(closedGap.gapAfterLogo).toBeGreaterThanOrEqual(-1)
  await page.screenshot({ path: `${shots}/T4-desktop-1280-closed.png` })

  const what = page.locator('header > .site-header-inner > nav details').filter({ hasText: 'What we do' }).first()
  await what.locator('summary').click()
  await expect(what).toHaveJSProperty('open', true)
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('header')!).backgroundColor)).toBe(PAPER)
  await page.waitForFunction(() => {
    const img = document.querySelector('header > .site-header-inner > nav details[open] .tile img') as HTMLImageElement | null
    return !!img && img.complete && img.naturalWidth > 0
  }, undefined, { timeout: 8_000 })
  const openDesktop = await page.evaluate((paper) => {
    const header = document.querySelector('header')!
    const panel = document.querySelector('header > .site-header-inner > nav details[open] .nav-drop')!
    const summary = document.querySelector('header > .site-header-inner > nav details[open] > summary')!
    const big = [...document.querySelectorAll('header > .site-header-inner > nav details[open] .tile-lg')].map((el) => {
      const box = el.getBoundingClientRect()
      return { w: Math.round(box.width), h: Math.round(box.height) }
    })
    const small = [...document.querySelectorAll('header > .site-header-inner > nav details[open] .tile-sm')].map((el) => {
      const box = el.getBoundingClientRect()
      return { w: Math.round(box.width), h: Math.round(box.height) }
    })
    const link = document.querySelector('header > .site-header-inner > nav details[open] .nav-mega-links')
    return {
      headerBg: getComputedStyle(header).backgroundColor,
      paper,
      headerW: header.getBoundingClientRect().width,
      panelW: panel.getBoundingClientRect().width,
      panelH: panel.getBoundingClientRect().height,
      summaryColor: getComputedStyle(summary).color,
      big,
      small,
      listStyle: link ? getComputedStyle(link).listStyleType : '',
      barH: header.getBoundingClientRect().height,
    }
  }, PAPER)
  console.log('T4 desktop-1280 open', JSON.stringify(openDesktop))
  expect(openDesktop.headerBg).toBe(PAPER)
  expect(Math.abs(openDesktop.panelW - openDesktop.headerW)).toBeLessThanOrEqual(1)
  expect(openDesktop.summaryColor).toBe(ACCENT)
  expect(openDesktop.big).toHaveLength(2)
  expect(openDesktop.small).toHaveLength(3)
  expect(openDesktop.big[0]!.w).toBeGreaterThan(openDesktop.small[0]!.w)
  expect(openDesktop.big[0]!.w / openDesktop.big[0]!.h).toBeGreaterThan(1.8)
  expect(openDesktop.listStyle).toBe('none')
  await page.screenshot({ path: `${shots}/T4-desktop-1280-open.png` })

  await show(page, 1366, 900)
  const wide = await rowBand(page)
  console.log('T4 desktop-1366', JSON.stringify(wide))
  expect(wide!.band).toBeLessThanOrEqual(12)
  expect(wide!.scrollWidth).toBe(wide!.clientWidth)

  await show(page, 1024, 900)
  const tablet = await rowBand(page)
  const pieces = await page.evaluate(() => {
    const inner = document.querySelector('header > .site-header-inner')!
    const nodes = [...inner.children].map((el) => ({
      tag: el.tagName,
      cls: (el as HTMLElement).className.toString().slice(0, 40),
      w: Math.round(el.getBoundingClientRect().width),
    }))
    const links = [...inner.querySelectorAll(':scope > nav > a, :scope > nav > details > summary')].map((el) => ({
      t: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
      w: Math.round(el.getBoundingClientRect().width),
    }))
    return { inner: Math.round(inner.getBoundingClientRect().width), nodes, links }
  })
  console.log('T4 desktop-1024', tablet, JSON.stringify(pieces))
  expect(tablet!.band).toBeLessThanOrEqual(12)
  expect(tablet!.overlap).toBeGreaterThan(0)
  expect(tablet!.scrollWidth).toBe(tablet!.clientWidth)
  expect(pieces.links[0] && pieces.nodes[0] ? pieces.links[0].w : 0).toBeGreaterThan(0)
  const gapAfterLogo = await page.evaluate(() => {
    const logo = document.querySelector('header .site-title')!.getBoundingClientRect()
    const link = document.querySelector('header > .site-header-inner > nav > a, header > .site-header-inner > nav > details > summary')!.getBoundingClientRect()
    return link.left - logo.right
  })
  expect(gapAfterLogo).toBeGreaterThanOrEqual(-1)

  await show(page, 375, 812)
  const phoneClosed = await page.evaluate(() => {
    const logo = document.querySelector('header .site-logo')!.getBoundingClientRect()
    const burger = document.querySelector('header details.nav-hamburger > summary')!
    const burgerBox = burger.getBoundingClientRect()
    const header = document.querySelector('header')!.getBoundingClientRect()
    return {
      logoW: logo.width,
      logoH: logo.height,
      burgerW: burgerBox.width,
      burgerH: burgerBox.height,
      burgerRadius: getComputedStyle(burger).borderRadius,
      barH: header.height,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }
  })
  console.log('T4 phone-375 closed', JSON.stringify(phoneClosed))
  expect(phoneClosed.logoW).toBeGreaterThanOrEqual(110)
  expect(phoneClosed.logoW).toBeLessThanOrEqual(170)
  expect(phoneClosed.burgerW).toBeCloseTo(44, 0)
  expect(phoneClosed.burgerH).toBeCloseTo(44, 0)
  expect(parseFloat(phoneClosed.burgerRadius)).toBeGreaterThanOrEqual(20)
  expect(phoneClosed.scrollWidth).toBe(phoneClosed.clientWidth)
  await page.screenshot({ path: `${shots}/T4-phone-375-closed.png` })

  await page.locator('header details.nav-hamburger > summary').click()
  await expect(page.locator('header details.nav-hamburger')).toHaveJSProperty('open', true)
  await page.locator('header .nav-panel details').filter({ hasText: 'What we do' }).locator('summary').click()
  await page.waitForFunction(() => {
    const img = document.querySelector('header .nav-panel details[open] .tile img') as HTMLImageElement | null
    return !!img && img.complete && img.naturalWidth > 0
  }, undefined, { timeout: 8_000 })
  await expect.poll(() => page.evaluate(() => {
    const header = getComputedStyle(document.querySelector('header')!).backgroundColor
    const bar = document.querySelector('header details.nav-hamburger[open] > summary span:nth-child(1)')
    const mid = document.querySelector('header details.nav-hamburger[open] > summary span:nth-child(2)')
    const chev = document.querySelector('header .nav-panel details[open] > summary .nav-chev')
    const nums = (bar ? getComputedStyle(bar).transform : '').match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    const angle = nums.length >= 2 ? Math.abs(Math.atan2(nums[1]!, nums[0]!) * 180 / Math.PI) : 0
    const c0 = Number((chev ? getComputedStyle(chev).transform : '').match(/-?\d+\.?\d*/g)?.[0] ?? '1')
    const ready = header === 'rgb(255, 250, 243)' && angle > 40 && getComputedStyle(mid!).opacity === '0' && c0 < -0.9
    return ready ? 'ready' : `${header}|${angle.toFixed(1)}|${c0}`
  })).toBe('ready')
  const phoneOpen = await page.evaluate((message) => {
    const root = document.documentElement
    const panel = document.querySelector('header details.nav-hamburger .nav-panel')!
    const row = document.querySelector('header .nav-panel > details > summary')!
    const report = document.querySelector('header .nav-panel .nav-report')
    const style = getComputedStyle(panel)
    const bars = [...document.querySelectorAll('header details.nav-hamburger > summary span')].map((el) => getComputedStyle(el).transform)
    const chev = document.querySelector('header .nav-panel details[open] > summary .nav-chev')
    const sub = document.querySelector('header .nav-panel details[open] .nav-mega-links')
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      panelScroll: panel.scrollHeight - panel.clientHeight,
      overflowY: style.overflowY,
      rowH: row.getBoundingClientRect().height,
      report: report?.textContent ?? '',
      position: getComputedStyle(document.querySelector('header')!).position,
      bars,
      chev: chev ? getComputedStyle(chev).transform : '',
      listStyle: sub ? getComputedStyle(sub).listStyleType : '',
    }
  }, MESSAGE)
  console.log('T4 phone-375 open', JSON.stringify(phoneOpen))
  expect(phoneOpen.scrollWidth).toBe(phoneOpen.clientWidth)
  expect(phoneOpen.panelScroll).toBeLessThanOrEqual(1)
  expect(phoneOpen.overflowY).not.toBe('auto')
  expect(phoneOpen.overflowY).not.toBe('scroll')
  expect(phoneOpen.rowH).toBeGreaterThanOrEqual(56)
  expect(phoneOpen.report).toBe(MESSAGE)
  expect(phoneOpen.position).toBe('relative')
  await page.screenshot({ path: `${shots}/T4-phone-375-open.png` })

  await show(page, 375, 812, false)
  await page.locator('header details.nav-hamburger > summary').click()
  await expect(page.locator('header .nav-panel .nav-report')).toHaveCount(0)
})
