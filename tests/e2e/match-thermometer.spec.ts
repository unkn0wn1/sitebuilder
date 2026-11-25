import { expect, test, type Page } from 'playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MatchThermometer } from '../../shared/blocks/library'
import { emptyPageDoc } from '../../shared/page'
import { THERMOMETER_JS, renderPageHtml } from '../../server/services/render'
import { SECTION_CASES, SECTION_NOW, SECTION_RENDER } from '../fixtures/sections-default/cases'

// Drawn with setContent. No app server.

const shots = process.env.E2E_SHOTS_DIR ?? join(tmpdir(), 'sitebuilder-e2e-shots')

function browserHtml(html: string, script: 'run' | 'omit'): string {
  let out = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '')
  const tag = '<script src="/thermometer.js" defer></script>'
  if (!out.includes(tag)) throw new Error('renderer did not emit /thermometer.js')
  if (script === 'run') return out.replace(tag, `<script>${THERMOMETER_JS}</script>`)
  return out.replace(tag, '')
}

async function renderHtml(): Promise<string> {
  const doc = emptyPageDoc('Match')
  doc.blocks = [{ id: 'b_matchthermo', type: 'MatchThermometer', v: 1, props: MatchThermometer.sample as Record<string, unknown> }]
  const site = SECTION_CASES[0]!.site
  const rendered = await renderPageHtml({ ...SECTION_RENDER, doc, site, now: SECTION_NOW })
  return rendered.html
}

async function show(page: Page, width: number, script: 'run' | 'omit') {
  await page.setViewportSize({ width, height: 1400 })
  const html = browserHtml(await renderHtml(), script)
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
}

test('desktop tube misses every tick label and the phone uses the bar', async ({ page }) => {
  mkdirSync(shots, { recursive: true })
  await show(page, 1280, 'omit')
  await expect(page.locator('.th-tube')).toBeVisible()
  await expect(page.locator('.th-bar')).toBeHidden()
  await expect(page.getByRole('img', { name: '$28,800 of $60,000, 48 percent' })).toBeVisible()
  const labels = await page.locator('.th-ticks text').allTextContents()
  expect(labels).not.toContain('$30K')
  expect(labels).toEqual(expect.arrayContaining(['$15K', '$45K', '$60K']))
  const overlaps = await page.evaluate(() => {
    const badge = document.querySelector('.th-badge rect')
    const texts = [...document.querySelectorAll('.th-ticks text')]
    if (!badge) return ['missing badge']
    const b = badge.getBoundingClientRect()
    return texts
      .filter((node) => {
        const r = node.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top
      })
      .map((node) => node.textContent ?? '')
  })
  expect(overlaps).toEqual([])
  const desktopCard = await page.locator('.th').boundingBox()
  const desktopSection = await page.locator('section.section').boundingBox()
  console.log('T1 desktop card', desktopCard, 'section', desktopSection)
  await page.locator('section.section').screenshot({ path: `${shots}/T1-desktop-1280.png` })

  await show(page, 375, 'omit')
  await expect(page.locator('.th-bar')).toBeVisible()
  await expect(page.locator('.th-tube')).toBeHidden()
  const scroll = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }))
  expect(scroll.sw).toBeLessThanOrEqual(scroll.cw + 1)
  const phoneCard = await page.locator('.th').boundingBox()
  const phoneSection = await page.locator('section.section').boundingBox()
  console.log('T1 phone card', phoneCard, 'section', phoneSection)
  await page.locator('section.section').screenshot({ path: `${shots}/T1-phone-375.png` })
  expect(phoneCard!.height).toBeGreaterThan(400)
  expect(phoneCard!.height).toBeLessThan(1400)
  expect(desktopCard!.height).toBeGreaterThan(400)
})

test('countdown ticks from the pinned instant and then shows the ended sentence', async ({ page }) => {
  // Install slightly early so page load can run, then pause on the pinned instant.
  // A running clock keeps firing the one-second interval while expects poll.
  await page.clock.install({ time: new Date('2026-11-23T00:59:00.000Z') })
  await show(page, 1280, 'run')
  await page.clock.pauseAt(new Date('2026-11-23T01:00:00.000Z'))
  await expect(page.locator('.th-cd b').nth(0)).toHaveText('9')
  await expect(page.locator('.th-cd b').nth(1)).toHaveText('03')
  await expect(page.locator('.th-cd b').nth(2)).toHaveText('59')
  await expect(page.locator('.th-cd b').nth(3)).toHaveText('59')
  await page.clock.fastForward(1000)
  await expect(page.locator('.th-cd b').nth(3)).toHaveText('58')

  await page.clock.pauseAt(new Date('2026-12-02T04:59:59.000Z'))
  await expect(page.locator('.th-cd')).toHaveText('This match has ended. Gifts still help.')
})
