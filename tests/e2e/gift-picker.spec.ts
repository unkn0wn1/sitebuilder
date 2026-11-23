import { expect, test, type Page } from 'playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { SAMPLE_MEDIA_ID } from '../../shared/blocks/library'
import { emptyPageDoc } from '../../shared/page'
import { renderPageHtml } from '../../server/services/render'
import { SECTION_CASES, SECTION_RENDER } from '../fixtures/sections-default/cases'

// Drawn with setContent. No app server. Photos are the option shots, swapped in after render.

const shots = '/workspace/briefs/together-redesign/grok-shots'

const rows = [
  ['$10', 'Feeds a recovering dog for a week', 'Warm meals and clean water while a rescued dog heals.', 'Recovering rescued dogs resting on blankets at the Animal Aid Unlimited hospital'],
  ['$25', 'Treats a wound', 'Cleaning, dressing and medicine for an injured street dog.', 'A vet and a carer gently examining a rescued puppy'],
  ['$50', 'Teaches kindness locally', 'A community visit teaching children how to care for street animals.', 'Rescue team members and schoolchildren gathered around a rescued dog'],
  ['$100', 'Pays for a surgery', 'A skilled surgical team gives an animal a second chance.', 'A surgeon in blue scrubs operating on an animal'],
  ['$250', 'A month of care for a paralysed dog', 'Physio, nursing and love until he finds his feet.', 'A smiling rescuer cuddling a black dog'],
] as const

function browserHtml(html: string): string {
  return html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
}

async function renderHtml(): Promise<string> {
  const doc = emptyPageDoc('Give')
  doc.blocks = [
    {
      id: 'b_giftpick1',
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
  ]
  const rendered = await renderPageHtml({ ...SECTION_RENDER, doc, site: SECTION_CASES[0]!.site })
  return rendered.html
}

async function paintPhotos(page: Page) {
  const urls = [1, 2, 3, 4, 5].map(
    (n) => `data:image/webp;base64,${readFileSync(`/workspace/briefs/together-redesign/options/img/g${n}-800.webp`).toString('base64')}`,
  )
  await page.evaluate((sources) => {
    document.querySelectorAll('.ga-f').forEach((fig, index) => {
      fig.querySelectorAll('source').forEach((node) => node.remove())
      const img = fig.querySelector('img')
      if (img && sources[index]) img.src = sources[index]
    })
  }, urls)
  await page.waitForFunction(() => {
    const img = document.querySelector('.ga-f img') as HTMLImageElement | null
    return !!img && img.complete && img.naturalWidth > 0
  })
}

async function show(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1400 })
  await page.setContent(browserHtml(await renderHtml()), { waitUntil: 'domcontentloaded' })
  await paintPhotos(page)
}

test('picking a row changes the photo, caption and Give button', async ({ page }) => {
  mkdirSync(shots, { recursive: true })
  const html = browserHtml(await renderHtml())
  expect(html).not.toContain('/picker.js')
  const figures = [...html.matchAll(/<figure class="ga-f"([^>]*)>/g)].map((match) => match[1] ?? '')
  expect(figures[0]).not.toContain('hidden')
  expect(figures.slice(1).every((attrs) => attrs.includes('hidden'))).toBe(true)

  await show(page, 1280)
  await expect(page.locator('.ga-sr').nth(0)).toBeChecked()
  const desktopCard = await page.locator('.ga').boundingBox()
  const desktopSection = await page.locator('section.section').boundingBox()
  console.log('T2 desktop card', desktopCard, 'section', desktopSection)
  await page.locator('section.section').screenshot({ path: `${shots}/T2-desktop-1280.png` })
  // Five 64px rows beside a 4/3 photo, in the 1120px column, measure 480. The 520 floor was an estimate.
  expect(desktopCard!.height).toBeGreaterThanOrEqual(460)
  expect(desktopCard!.height).toBeLessThanOrEqual(700)

  await page.locator('.ga-sr').first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.ga-sr').nth(1)).toBeChecked()
  await expect(page.getByRole('link', { name: 'Give $25', exact: true })).toBeVisible()

  await page.locator('.ga-l').nth(2).click()
  await expect(page.locator('.ga-sr').nth(2)).toBeChecked()
  await expect(page.locator('.ga-f').nth(2)).toBeVisible()
  await expect(page.locator('.ga-f').nth(0)).toBeHidden()
  await expect(page.locator('.ga-f').nth(2).locator('figcaption')).toContainText('A community visit teaching children how to care for street animals.')
  await expect(page.locator('.ga-f').nth(2).locator('figcaption')).toContainText('$50')
  await expect(page.getByRole('link', { name: 'Give $50', exact: true })).toBeVisible()

  await show(page, 375)
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(scroll.sw).toBeLessThanOrEqual(scroll.cw + 1)
  const phoneCard = await page.locator('.ga').boundingBox()
  const phoneSection = await page.locator('section.section').boundingBox()
  console.log('T2 phone card', phoneCard, 'section', phoneSection)
  await page.locator('section.section').screenshot({ path: `${shots}/T2-phone-375.png` })
  expect(phoneCard!.height).toBeLessThanOrEqual(900)
  expect(phoneCard!.height).toBeGreaterThan(400)

  await page.evaluate(() => {
    document.querySelectorAll('style').forEach((node) => node.remove())
  })
  await expect(page.locator('.ga-f').nth(0)).toBeVisible()
  await expect(page.locator('.ga-f').nth(1)).toBeHidden()
  await expect(page.locator('.ga-give').nth(0)).toBeVisible()
  await expect(page.locator('.ga-give').nth(1)).toBeHidden()
})
