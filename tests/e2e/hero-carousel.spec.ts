import { expect, test, type Page } from 'playwright/test'
import { HERO_JS, renderPageHtml } from '../../server/services/render'
import { HERO_MODE_CASES, SECTION_RENDER } from '../fixtures/sections-default/cases'

// Drawn in this process and loaded with setContent. There is no app server: the seeded server allows
// 10 sign-ins per email per 15 minutes, and the other specs already use them.

type CarouselKind = 'hero-image-carousel' | 'hero-video-carousel'

function browserHtml(html: string, script: 'run' | 'omit'): string {
  let out = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
  out = out.replace('</section>', '</section><p><a id="after-hero" href="#more">More</a></p>')
  const tag = '<script src="/hero.js" defer></script>'
  if (!out.includes(tag)) throw new Error('renderer did not emit /hero.js')
  if (script === 'run') return out.replace(tag, `<script>${HERO_JS}</script>`)
  return out.replace(tag, '')
}

async function show(page: Page, kind: CarouselKind, script: 'run' | 'omit') {
  const entry = HERO_MODE_CASES.find((item) => item.name === kind)
  if (!entry) throw new Error(kind)
  const rendered = await renderPageHtml({ ...SECTION_RENDER, doc: entry.doc, site: entry.site })
  await page.setContent(browserHtml(rendered.html, script), { waitUntil: 'domcontentloaded' })
}

async function activeIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const slides = [...document.querySelectorAll('.hero-slide')]
    return slides.findIndex((slide) => !slide.hasAttribute('hidden'))
  })
}

test('noscript keeps the first slide and hides the controls', async ({ page }) => {
  await show(page, 'hero-video-carousel', 'omit')
  await expect(page.locator('.hero-carousel')).not.toHaveClass(/js-hero/)
  await expect(page.locator('.hero-slide').nth(0)).toBeVisible()
  await expect(page.locator('.hero-slide').nth(1)).toBeHidden()
  await expect(page.locator('.hero-controls')).toBeHidden()
  await expect(page.locator('video source')).toHaveCount(0)
  await expect(page.locator('.hero-inner h1')).toHaveText('A warm bed tonight')
  await expect(page.locator('.hero-inner p')).toHaveText('Blankets for every kennel.')
})

test('advances on a timer, then pauses for controls and keys', async ({ page }) => {
  await page.clock.install()
  await show(page, 'hero-image-carousel', 'run')
  const region = page.locator('section.hero-carousel')
  await expect(region).toHaveClass(/js-hero/)
  await expect(region).toHaveAttribute('aria-roledescription', 'carousel')
  await expect(page.locator('.hero-slide').first()).toHaveAttribute('aria-roledescription', 'slide')
  await expect(page.getByRole('button', { name: 'Previous slide' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next slide' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Slide 1 of 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Slide 2 of 2' })).toBeVisible()
  await expect(page.locator('.hero-live')).toHaveAttribute('aria-live', 'off')

  const boxes = await page.locator('.hero-controls button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect()
      return { w: box.width, h: box.height }
    }),
  )
  expect(boxes.length).toBeGreaterThanOrEqual(5)
  for (const box of boxes) {
    expect(box.w).toBeGreaterThanOrEqual(44)
    expect(box.h).toBeGreaterThanOrEqual(44)
  }

  expect(await activeIndex(page)).toBe(0)
  await expect(page.locator('.hero-inner h1')).toHaveText('A warm bed tonight')
  await expect(page.locator('.hero-inner p')).toHaveText('Blankets for every kennel.')

  await page.clock.fastForward(6000)
  expect(await activeIndex(page)).toBe(1)
  await expect(page.locator('.hero-inner h1')).toHaveText('Food and treatment')
  await expect(page.locator('.hero-inner p')).toBeHidden()
  await expect(page.locator('.hero-dot').nth(1)).toHaveAttribute('aria-current', 'true')

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.hero-live')).toHaveAttribute('aria-live', 'polite')
  await page.clock.fastForward(6000)
  expect(await activeIndex(page)).toBe(1)

  await page.getByRole('button', { name: 'Next slide' }).click()
  expect(await activeIndex(page)).toBe(0)
  await expect(page.locator('.hero-inner h1')).toHaveText('A warm bed tonight')
  await expect(page.locator('.hero-inner p')).toHaveText('Blankets for every kennel.')
  await page.clock.fastForward(6000)
  expect(await activeIndex(page)).toBe(0)

  await page.getByRole('button', { name: 'Previous slide' }).click()
  expect(await activeIndex(page)).toBe(1)
  await page.clock.fastForward(6000)
  expect(await activeIndex(page)).toBe(1)

  await page.getByRole('button', { name: 'Slide 1 of 2' }).click()
  expect(await activeIndex(page)).toBe(0)
  await page.clock.fastForward(6000)
  expect(await activeIndex(page)).toBe(0)

  await region.focus()
  await page.keyboard.press('ArrowRight')
  expect(await activeIndex(page)).toBe(1)
  await page.keyboard.press('ArrowLeft')
  expect(await activeIndex(page)).toBe(0)
  await page.keyboard.press('End')
  expect(await activeIndex(page)).toBe(1)
  await page.keyboard.press('Home')
  expect(await activeIndex(page)).toBe(0)

  await page.locator('#after-hero').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('End')
  expect(await activeIndex(page)).toBe(0)
})

test('reduced motion does not advance or attach a video source', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await show(page, 'hero-video-carousel', 'run')
  await expect(page.locator('.hero-carousel')).toHaveClass(/js-hero/)
  await expect(page.locator('.hero-live')).toHaveAttribute('aria-live', 'polite')
  await expect(page.locator('video source')).toHaveCount(0)
  expect(await activeIndex(page)).toBe(0)
  await page.clock.fastForward(8000)
  expect(await activeIndex(page)).toBe(0)
  await expect(page.locator('video source')).toHaveCount(0)
})

test('a wide page with motion attaches one video source on the active slide', async ({ page }) => {
  await page.clock.install()
  await show(page, 'hero-video-carousel', 'run')
  await expect(page.locator('video source')).toHaveCount(1)
  await expect(page.locator('.hero-slide').nth(0).locator('video source')).toHaveAttribute('type', 'video/mp4')
  await expect(page.locator('.hero-slide').nth(1).locator('video source')).toHaveCount(0)
})
