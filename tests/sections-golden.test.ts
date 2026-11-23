import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SAMPLE_MEDIA_ID } from '../shared/blocks/library'
import { BUNDLE_ID, THEME_CSS, renderPageHtml } from '../server/services/render'
import { DONATE_PREVIEW_CSS, THERMOMETER_CSS } from '../shared/theme-css'
import { HERO_MODE_CASES, SECTION_CASES, SECTION_NOW, SECTION_RENDER } from './fixtures/sections-default/cases'
import type { PageDoc } from '../shared/page'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/sections-default')

function bodyOf(html: string): string {
  const start = html.indexOf('<body>')
  const end = html.lastIndexOf('</body>')
  return html.slice(start, end)
}

describe('starter sections match the golden HTML', () => {
  it.each(SECTION_CASES.map((c) => c.name))('%s is byte-identical', async (name) => {
    const sectionCase = SECTION_CASES.find((c) => c.name === name)!
    const rendered = await renderPageHtml({ ...SECTION_RENDER, doc: sectionCase.doc, site: sectionCase.site, now: SECTION_NOW })
    const expected = readFileSync(join(fixtureDir, `${name}.html`), 'utf8')
    expect(rendered.html).toBe(expected)
    expect(rendered.deps.bundleId).toBe(BUNDLE_ID)
    expect(rendered.html).toContain(rendered.csp)
  })

  it('keeps the default sheet on the stock brand and swaps only the accent on the custom brand', async () => {
    const stock = SECTION_CASES.find((c) => c.name === 'all-blocks-default')!
    const custom = SECTION_CASES.find((c) => c.name === 'all-blocks-custom-accent')!
    const stockHtml = await renderPageHtml({ ...SECTION_RENDER, doc: stock.doc, site: stock.site, now: SECTION_NOW })
    const customHtml = await renderPageHtml({ ...SECTION_RENDER, doc: custom.doc, site: custom.site, now: SECTION_NOW })
    expect(stockHtml.html).toContain('<style>' + THEME_CSS + THERMOMETER_CSS + DONATE_PREVIEW_CSS + '</style>')
    expect(customHtml.html).toContain('--accent: #113399;')
    expect(customHtml.html).not.toContain('--accent: #b5471d;')
    expect(bodyOf(customHtml.html)).toBe(bodyOf(stockHtml.html))
  })

  it('uses the Together sizes for the closing band, quote and tier amount', () => {
    expect(THEME_CSS).toContain('.cta-band h2 { font-size: clamp(30px, 7.5vw, 52px); line-height: 1.08; letter-spacing: -0.015em; }')
    expect(THEME_CSS).toContain('.cta-band p { font-size: clamp(17px, 2.4vw, 20px); }')
    expect(THEME_CSS).toContain('.cta-band .btn { min-height: 60px; font-size: 20px; }')
    expect(THEME_CSS).toContain('.cta-band .btn { width: 100%; }')
    expect(THEME_CSS).toMatch(/@media \(max-width: 480px\) \{\s*\.cta-band \.btn \{ width: 100%; \}/)
    expect(THEME_CSS).toContain('font-size:clamp(22px, 3.2vw, 32px)')
    expect(THEME_CSS).toContain('.quote + .btn, .before-after + .btn { margin-top: 1.5rem; }')
    expect(THEME_CSS).toContain('.tier-amount { font-size: clamp(22px, 5.5vw, 28px); font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;')
    expect(THEME_CSS).toContain('font-size:var(--fs-stat)')
  })

  it('paints the donation progress bar with theme tokens', () => {
    expect(THEME_CSS).toContain('.goal-progress { appearance: none; -webkit-appearance: none; width: 100%; height: 12px; border: 0; border-radius: var(--radius-pill); background: var(--band); color: var(--accent); overflow: hidden; }')
    expect(THEME_CSS).toContain('.goal-progress::-webkit-progress-bar { background: var(--band); border-radius: var(--radius-pill); }')
    expect(THEME_CSS).toContain('.goal-progress::-webkit-progress-value { background: linear-gradient(90deg, var(--accent), var(--highlight)); border-radius: var(--radius-pill); }')
    expect(THEME_CSS).toContain('.goal-progress::-moz-progress-bar { background: linear-gradient(90deg, var(--accent), var(--highlight)); border-radius: var(--radius-pill); }')
    expect(THEME_CSS).not.toContain('accent-color')
    expect(THEME_CSS).not.toMatch(/\.goal-progress[^{]*\{[^}]*#[0-9a-fA-F]{3,8}/)
  })

  it('sets picture sizes from the column each block occupies', async () => {
    const grid = '(min-width: 1160px) 364px, (min-width: 1024px) 33vw, (min-width: 700px) 50vw, 100vw'
    const half = '(min-width: 1160px) 560px, (min-width: 700px) 50vw, 100vw'
    const figure = '(min-width: 1160px) 70rem, calc(100vw - 2.5rem)'
    const stock = SECTION_CASES.find((entry) => entry.name === 'all-blocks-default')!
    const doc = structuredClone(stock.doc) as PageDoc
    const cards = doc.blocks.find((block) => block.type === 'CardGrid')
    const card = (cards?.props.cards as { image?: { media: string; alt: string } }[] | undefined)?.[0]
    const tiers = doc.blocks.find((block) => block.type === 'ImpactTiers')
    const tier = (tiers?.props.items as { image?: { media: string; alt: string } }[] | undefined)?.[0]
    expect(card).toBeTruthy()
    expect(tier).toBeTruthy()
    card!.image = { media: SAMPLE_MEDIA_ID, alt: 'A rescued animal' }
    tier!.image = { media: SAMPLE_MEDIA_ID, alt: 'A meal' }
    const rendered = await renderPageHtml({ ...SECTION_RENDER, doc, site: stock.site, now: SECTION_NOW })
    const html = rendered.html

    const heroes = elementsByClass(html, 'section', 'hero')
    expect(heroes).toHaveLength(2)
    for (const hero of heroes) assertPictureSizes(hero, '100vw')
    assertPictureSizes(elementsByClass(html, 'div', 'cards')[0]!, grid)
    assertPictureSizes(elementsByClass(html, 'div', 'tiers')[0]!, grid)
    assertPictureSizes(elementsByClass(html, 'div', 'gallery')[0]!, grid)
    assertPictureSizes(elementsByClass(html, 'div', 'split')[0]!, half)
    assertPictureSizes(elementsByClass(html, 'div', 'before-after')[0]!, half)
    assertPictureSizes(elementsByClass(html, 'figure', 'figure')[0]!, figure)
    assertPictureSizes(elementsByClass(html, 'ul', 'trust-strip')[0]!, '10rem')

    const carousel = HERO_MODE_CASES.find((entry) => entry.name === 'hero-image-carousel')!
    const slides = await renderPageHtml({ ...SECTION_RENDER, doc: carousel.doc, site: carousel.site, now: SECTION_NOW })
    const carouselHero = elementsByClass(slides.html, 'section', 'hero-carousel')
    expect(carouselHero).toHaveLength(1)
    assertPictureSizes(carouselHero[0]!, '100vw')
  })
})

function elementsByClass(html: string, tag: string, className: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*\\bclass="([^"]*)"[^>]*>`, 'g')
  const found: string[] = []
  for (const match of html.matchAll(re)) {
    if (!match[1]!.split(/\s+/).includes(className)) continue
    const start = match.index ?? 0
    const open = `<${tag}`
    const close = `</${tag}>`
    let depth = 0
    let i = start
    let end = -1
    while (i < html.length) {
      if (html.startsWith(open, i)) {
        depth += 1
        i += open.length
        continue
      }
      if (html.startsWith(close, i)) {
        depth -= 1
        i += close.length
        if (depth === 0) {
          end = i
          break
        }
        continue
      }
      i += 1
    }
    if (end < 0) throw new Error(`unclosed <${tag} class="${className}">`)
    found.push(html.slice(start, end))
  }
  return found
}

function assertPictureSizes(fragment: string, sizes: string) {
  const pictures = [...fragment.matchAll(/<picture\b[\s\S]*?<\/picture>/g)].map((match) => match[0])
  expect(pictures.length).toBeGreaterThan(0)
  for (const picture of pictures) {
    const sources = [...picture.matchAll(/<source\b([^>]*)>/g)].map((match) => match[1]!)
    const avif = sources.find((attrs) => attrs.includes('type="image/avif"'))
    const webp = sources.find((attrs) => attrs.includes('type="image/webp"'))
    expect(avif).toBeTruthy()
    expect(webp).toBeTruthy()
    expect(avif).toContain(`sizes="${sizes}"`)
    expect(webp).toContain(`sizes="${sizes}"`)
  }
}
