import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Hero, SAMPLE_VIDEO_ID, VideoHero } from '../shared/blocks/library'
import { emptyPageDoc } from '../shared/page'
import { HERO_CAROUSEL_CSS, THEME_CSS } from '../shared/theme-css'
import { HERO_JS, renderPageHtml, styleHash } from '../server/services/render'
import { HERO_MODE_CASES, SECTION_CASES, SECTION_RENDER } from './fixtures/sections-default/cases'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/item5')
const site = SECTION_CASES.find((entry) => entry.name === 'all-blocks-default')!.site
const heroSample = Hero.sample as Record<string, unknown>

function bodyOf(html: string): string {
  const start = html.indexOf('<body>')
  const end = html.lastIndexOf('</body>')
  return html.slice(start, end)
}

// Frozen item 5 markup (tests/fixtures/item5). scripts/regen-golden.ts does not write those files.
// Strip the style block and CSP sha256 hashes, then keep the body, so a later THEME_CSS change leaves this check alone.
function item5Markup(html: string): string {
  const stripped = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/'sha256-[^']*'/g, '')
  return bodyOf(stripped)
}

function heroSection(html: string): string {
  const start = html.indexOf('<section class="hero"')
  const end = html.indexOf('</section>', start)
  return html.slice(start, end + '</section>'.length)
}

function heroDoc(id: string, props: Record<string, unknown>, type = 'Hero') {
  const doc = emptyPageDoc('Sections')
  doc.blocks = [{ id, type, v: 1, props }]
  return doc
}

describe('hero modes', () => {
  it('keeps an old hero and mode image identical to the item 5 body markup', async () => {
    const expected = readFileSync(join(fixtureDir, 'hero-one.html'), 'utf8')
    const old = await renderPageHtml({ ...SECTION_RENDER, doc: heroDoc('b_hero', heroSample), site })
    const image = await renderPageHtml({ ...SECTION_RENDER, doc: heroDoc('b_hero', { ...heroSample, mode: 'image' }), site })
    expect(item5Markup(old.html)).toBe(expected)
    expect(item5Markup(image.html)).toBe(expected)
    expect(old.html).toContain('<style>' + THEME_CSS + '</style>')
    expect(old.html).not.toContain('/hero.js')
    expect(image.html).not.toContain('/hero.js')
    const allBlocks = SECTION_CASES.find((entry) => entry.name === 'all-blocks-default')!
    const all = await renderPageHtml({ ...SECTION_RENDER, doc: allBlocks.doc, site: allBlocks.site })
    expect(heroSection(old.html)).toBe(heroSection(all.html))
  })

  it('keeps an old video hero identical to the item 5 body markup', async () => {
    const expected = readFileSync(join(fixtureDir, 'videohero-one.html'), 'utf8')
    const rendered = await renderPageHtml({
      ...SECTION_RENDER,
      doc: heroDoc('b_videohero', VideoHero.sample as Record<string, unknown>, 'VideoHero'),
      site,
    })
    expect(item5Markup(rendered.html)).toBe(expected)
    expect(rendered.html).toContain('<style>' + THEME_CSS + '</style>')
    expect(bodyOf(rendered.html)).not.toContain('hero-carousel')
    expect(rendered.html).not.toContain('/hero.js')
  })

  it('renders hero video mode like a video hero, and a short carousel as that single mode', async () => {
    const video = HERO_MODE_CASES.find((entry) => entry.name === 'hero-video')!
    const rendered = await renderPageHtml({ ...SECTION_RENDER, doc: video.doc, site: video.site })
    const videoHero = readFileSync(join(fixtureDir, 'videohero-one.html'), 'utf8')
    expect(item5Markup(rendered.html)).toBe(videoHero)
    expect(rendered.html).toContain('<source src="/media/' + SAMPLE_VIDEO_ID + '.mp4"')
    expect(bodyOf(rendered.html)).not.toContain('hero-carousel')
    expect(rendered.html).not.toContain(HERO_CAROUSEL_CSS)

    const shortImage = await renderPageHtml({
      ...SECTION_RENDER,
      doc: heroDoc('b_hero', { ...heroSample, mode: 'image-carousel', slides: [{ image: heroSample.image }] }),
      site,
    })
    expect(item5Markup(shortImage.html)).toBe(readFileSync(join(fixtureDir, 'hero-one.html'), 'utf8'))
    expect(shortImage.html).not.toContain('/hero.js')

    const shortVideo = await renderPageHtml({
      ...SECTION_RENDER,
      doc: heroDoc('b_herovid', { ...heroSample, mode: 'video-carousel', video: SAMPLE_VIDEO_ID, slides: [{ video: SAMPLE_VIDEO_ID }] }),
      site,
    })
    expect(item5Markup(shortVideo.html)).toBe(videoHero)
    expect(shortVideo.html).not.toContain('/hero.js')
  })

  it('renders a real carousel with hidden icon controls, the hero script, and carousel CSS', async () => {
    const imageCase = HERO_MODE_CASES.find((entry) => entry.name === 'hero-image-carousel')!
    const videoCase = HERO_MODE_CASES.find((entry) => entry.name === 'hero-video-carousel')!
    const image = await renderPageHtml({ ...SECTION_RENDER, doc: imageCase.doc, site: imageCase.site })
    const video = await renderPageHtml({ ...SECTION_RENDER, doc: videoCase.doc, site: videoCase.site })

    for (const rendered of [image, video]) {
      const body = bodyOf(rendered.html)
      expect(rendered.html).toContain('<style>' + THEME_CSS + HERO_CAROUSEL_CSS + '</style>')
      expect(body).toContain('aria-roledescription="carousel"')
      expect(body).toContain('aria-roledescription="slide"')
      expect(body).toContain('<div class="hero-controls" hidden>')
      expect(body).toContain('aria-label="Previous slide"')
      expect(body).toContain('aria-label="Pause"')
      expect(body).toContain('aria-label="Next slide"')
      expect(body).toContain('aria-live="off"')
      expect(body).toContain('Slide 1 of 2')
      expect(body).toContain('data-heading="A warm bed tonight"')
      expect(body).toContain('data-subheading="Blankets for every kennel."')
      expect(body).toContain('>A warm bed tonight</h1>')
      expect(body).toContain('>Blankets for every kennel.</p>')
      expect(body).toContain('tabindex="0"')
      expect(body).toContain('<span class="hero-sr">Previous slide</span>')
      expect(body).toContain('<span class="hero-sr">Pause</span>')
      expect(body).toContain('class="ico-pause"')
      expect(body).toContain('class="ico-play"')
      expect(body).toContain('<script src="/hero.js" defer></script>')
      expect(body.toLowerCase()).not.toContain('overflow')
      const csp = rendered.html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? ''
      const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src'))
      expect(scriptSrc).toBe("script-src 'self'")
      expect(csp).toContain(`style-src 'self' ${styleHash(THEME_CSS + HERO_CAROUSEL_CSS)}`)
      const slides = body.split('<div class="hero-slide"').slice(1)
      expect(slides).toHaveLength(2)
      expect(slides[0]!.slice(0, slides[0]!.indexOf('>'))).not.toContain('hidden')
      expect(slides[0]).toContain('data-subheading="Blankets for every kennel."')
      expect(slides[1]!.slice(0, slides[1]!.indexOf('>'))).toContain('hidden')
      expect(slides[1]).not.toContain('data-subheading')
      expect(slides[0]).toContain('loading="eager"')
      expect(slides[1]).toContain('loading="lazy"')
      expect(slides[0]).not.toContain('loading="lazy"')
    }

    const videoBody = bodyOf(video.html)
    expect(videoBody).toContain('data-src="/media/' + SAMPLE_VIDEO_ID + '.mp4"')
    expect(videoBody).toContain('data-type="video/mp4"')
    expect(videoBody).not.toContain('autoplay')
    expect(videoBody).not.toContain('<source src=')
    expect(bodyOf(image.html)).not.toContain('<video')
    expect(HERO_CAROUSEL_CSS.toLowerCase()).not.toContain('overflow')
    expect(THEME_CSS).toContain('.hero-carousel { min-height:clamp(22rem, 100vh, 52rem);min-height:clamp(22rem, 100svh, 52rem);overflow:hidden;}')
    expect(THEME_CSS).toMatch(/\.hero \{\s*position: relative;\s*min-height: min\(70vh, 36rem\);/)
    expect(THEME_CSS).not.toMatch(/\.hero \{[^}]*overflow/)
    expect(HERO_CAROUSEL_CSS).not.toContain('@keyframes')
    expect(HERO_CAROUSEL_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(HERO_JS.toLowerCase()).not.toContain('overflow')
    expect(HERO_JS).not.toContain('</script')
    expect(HERO_JS).not.toContain('document.addEventListener')
    expect(HERO_JS.toLowerCase()).not.toContain('scroll')
  })
})
