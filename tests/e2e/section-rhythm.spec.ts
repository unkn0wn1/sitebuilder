import { expect, test, type Page } from 'playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { Hero, MatchThermometer, SAMPLE_EMBED_ID, SAMPLE_MEDIA_ID, TrustStrip } from '../../shared/blocks/library'
import { emptyPageDoc } from '../../shared/page'
import { renderPageHtml } from '../../server/services/render'
import { SECTION_CASES, SECTION_NOW, SECTION_RENDER } from '../fixtures/sections-default/cases'

// Drawn with setContent. No app server. Photos are swapped in after render.

const shots = '/workspace/briefs/together-redesign/grok-shots'
const imgDir = '/workspace/briefs/together-redesign/options/img'

const rows = [
  ['$10', 'Feeds a recovering dog for a week', 'Warm meals and clean water while a rescued dog heals.', 'Recovering rescued dogs resting on blankets'],
  ['$25', 'Treats a wound', 'Cleaning, dressing and medicine for an injured street dog.', 'A vet examining a rescued puppy'],
  ['$50', 'Teaches kindness locally', 'A community visit teaching children how to care for street animals.', 'Schoolchildren gathered around a rescued dog'],
  ['$100', 'Pays for a surgery', 'A skilled surgical team gives an animal a second chance.', 'A surgeon operating on an animal'],
  ['$250', 'A month of care for a paralysed dog', 'Physio, nursing and love until he finds his feet.', 'A rescuer cuddling a dog'],
] as const

function browserHtml(html: string): string {
  return html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
}

async function renderHtml(): Promise<string> {
  const base = SECTION_CASES[0]!.site
  const embed = base.embeds[SAMPLE_EMBED_ID]!
  const doc = emptyPageDoc('Together')
  doc.blocks = [
    { id: 'b_hero', type: 'Hero', v: 1, props: Hero.sample },
    {
      id: 'b_gift',
      type: 'ImpactTiers',
      v: 1,
      props: {
        eyebrow: 'Udaipur, India',
        heading: 'How your gift is spent',
        intro: 'Every gift reaches a street animal in need. Pick an amount to see what it could help provide.',
        layout: 'picker',
        items: rows.map(([amount, title, explanation, alt]) => ({
          amount,
          title,
          explanation,
          image: { media: SAMPLE_MEDIA_ID, alt },
        })),
        otherAmount: 'Or give a different amount',
      },
    },
    { id: 'b_thermo', type: 'MatchThermometer', v: 1, props: { ...MatchThermometer.sample, background: 'card' } },
    {
      id: 'b_donate',
      type: 'DonationEmbed',
      v: 1,
      props: {
        embed: SAMPLE_EMBED_ID,
        heading: 'Be there for the next animal',
        anchor: 'donate',
        background: 'warm',
      },
    },
    { id: 'b_trust', type: 'TrustStrip', v: 1, props: TrustStrip.sample },
    {
      id: 'b_close',
      type: 'CallToAction',
      v: 1,
      props: {
        heading: 'Give a street animal a second chance',
        text: 'Your gift helps rescue, treat and care for injured and sick street animals.',
        button: { label: 'Donate now', href: '#donate' },
        tone: 'accent',
      },
    },
  ]
  const rendered = await renderPageHtml({
    ...SECTION_RENDER,
    doc,
    now: SECTION_NOW,
    site: {
      ...base,
      embeds: { ...base.embeds, [SAMPLE_EMBED_ID]: { ...embed, config: { ...embed.config, currency: '₹' } } },
    },
  })
  return rendered.html
}

function dataUrl(name: string): string {
  return `data:image/webp;base64,${readFileSync(`${imgDir}/${name}`).toString('base64')}`
}

async function paintPhotos(page: Page) {
  const photos = [1, 2, 3, 4, 5].map((n) => dataUrl(`g${n}-800.webp`))
  await page.evaluate(({ hero, gifts, logo }) => {
    const paint = (img: Element | null, src: string) => {
      const picture = img?.closest('picture')
      picture?.querySelectorAll('source').forEach((node) => node.remove())
      if (img instanceof HTMLImageElement) {
        img.srcset = ''
        img.src = src
      }
    }
    paint(document.querySelector('.hero-media img'), hero)
    document.querySelectorAll('.ga-f img').forEach((img, index) => paint(img, gifts[index] ?? gifts[0]!))
    document.querySelectorAll('.trust-logo, .trust-item img').forEach((img) => paint(img, logo))
  }, { hero: photos[0]!, gifts: photos, logo: dataUrl('logo.webp') })
}

async function show(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1400 })
  await page.setContent(browserHtml(await renderHtml()), { waitUntil: 'domcontentloaded' })
  await paintPhotos(page)
}

test('section rhythm and a static donate preview', async ({ page }) => {
  mkdirSync(shots, { recursive: true })
  const html = browserHtml(await renderHtml())
  expect(html).not.toContain('loads here')
  expect(html).not.toContain('<form')
  expect(html).toContain('class="hero')
  expect(html).toContain('class="section"')
  expect(html).toContain('class="section bg-card"')
  expect(html).toContain('class="donate bg-warm"')
  expect(html).toContain('tone-accent')
  expect(html).toContain('₹50')
  expect(html).toContain('disabled')
  const order = ['class="hero', 'class="section"', 'class="section bg-card"', 'class="donate bg-warm"', 'class="trust-strip"', 'cta-band tone-accent']
  let at = -1
  for (const marker of order) {
    const next = html.indexOf(marker, at + 1)
    expect(next).toBeGreaterThan(at)
    at = next
  }

  await show(page, 1280)
  const continueButton = page.locator('.donate-preview button')
  await expect(continueButton).toBeDisabled()
  await expect(page.locator('.dp-tab.is-on')).toHaveText('Give once')
  await expect(page.locator('.dp-chip.is-on')).toHaveText('₹50')
  const before = page.url()
  await continueButton.click({ force: true })
  expect(page.url()).toBe(before)

  const donate = await page.locator('section.donate').boundingBox()
  console.log('T5 desktop donate section', donate)
  expect(donate!.height).toBeGreaterThanOrEqual(550)
  expect(donate!.height).toBeLessThanOrEqual(1100)
  const gift = page.locator('section.section').first()
  await expect(gift).not.toHaveClass(/bg-card|bg-warm/)
  await expect(page.locator('section.bg-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('section.donate')!).backgroundImage)).toContain('linear-gradient')

  await page.screenshot({ path: `${shots}/T5-desktop-1280.png`, fullPage: true })

  await show(page, 375)
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(scroll.sw).toBeLessThanOrEqual(scroll.cw + 1)
  const phone = await page.locator('section.donate').boundingBox()
  console.log('T5 phone donate section', phone)
  await expect(page.locator('.donate-preview button')).toBeDisabled()
  await page.screenshot({ path: `${shots}/T5-phone-375.png`, fullPage: true })
})
