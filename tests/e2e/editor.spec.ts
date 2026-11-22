import { expect, test, type Page } from 'playwright/test'
import { mkdirSync } from 'node:fs'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'
const screenshotDir = process.env.EDITOR_SCREENSHOT_DIR ?? '/workspace'
const SECTION_CSS = '& { outline: 3px solid #b5471d; }'

function sectionCssSaved(page: Page) {
  return page.waitForResponse((res) => {
    if (!res.ok() || res.request().method() !== 'POST') return false
    if (!/\/api\/v1\/pages\/[^/]+\/ops$/.test(new URL(res.url()).pathname)) return false
    const body = res.request().postData() ?? ''
    return body.includes('set_block_css') && body.includes(SECTION_CSS)
  })
}

async function docsShot(page: Page, name: string, fullPage = true) {
  if (process.env.SB_SCREENSHOTS !== '1') return
  mkdirSync('docs/screenshots', { recursive: true })
  await page.screenshot({ path: `docs/screenshots/${name}`, fullPage })
}

async function previewHasOutline(page: Page): Promise<boolean> {
  const frames = page.locator('iframe[title="Page preview"]')
  const count = await frames.count()
  for (let i = 0; i < count; i++) {
    const frame = await frames.nth(i).contentFrame()
    if (!frame) continue
    const html = await frame.locator('html').evaluate((el) => el.outerHTML).catch(() => '')
    if (html.includes('data-sb-css') && /outline:\s*3px solid #b5471d/i.test(html)) return true
  }
  return false
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

function shot(name: string) {
  mkdirSync(screenshotDir, { recursive: true })
  return `${screenshotDir}/${name}`
}

test('editor opens a page with rails, canvas and inspector', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('link', { name: 'Winter appeal' })).toBeVisible()
  await page.getByRole('link', { name: 'Winter appeal' }).click()
  await expect(page.getByRole('heading', { name: 'Winter appeal' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('save-status')).toHaveText(/Saved|Saving/)
  await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Desktop' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Section' })).toBeVisible()

  await page.screenshot({ path: shot('editor-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('button', { name: 'Video hero' })).toBeVisible()
  await page.getByRole('button', { name: 'Mobile' }).click()
  await page.screenshot({ path: shot('editor-add-mobile.png'), fullPage: true })

  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: /Hero/ }).first().click()
  await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tablet' }).click()
  await page.screenshot({ path: shot('editor-inspector-tablet.png'), fullPage: true })

  const cssPanel = page.getByTestId('custom-css')
  await cssPanel.locator('summary').click()
  const cssSaved = sectionCssSaved(page)
  await cssPanel.getByRole('textbox', { name: 'CSS' }).fill(SECTION_CSS)
  await expect(page.getByTestId('save-status')).toHaveText('Saving…', { timeout: 15_000 })
  await expect.poll(() => previewHasOutline(page), { timeout: 20_000 }).toBe(true)
  const hero = page.getByRole('button', { name: /Hero/ }).first()
  await expect(hero).toContainText('{ }')
  await cssSaved
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 })
  await docsShot(page, 'custom-css-inspector.png')

  await cssPanel.getByRole('button', { name: 'Open full screen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Custom CSS' })).toBeVisible()
  await dialog.locator('.cm-content').click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // Saved was already on screen before the edit. Reload and read the stored text back.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Winter appeal' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: /Hero/ }).first().click()
  const savedPanel = page.getByTestId('custom-css')
  await savedPanel.locator('summary').click()
  await expect(savedPanel.getByRole('textbox', { name: 'CSS' })).toHaveValue(SECTION_CSS)
  await expect(page.getByRole('button', { name: /Hero/ }).first()).toContainText('{ }')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
})
