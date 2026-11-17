import { expect, test, type Page } from 'playwright/test'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'
const screenshotDir = process.env.EDITOR_SCREENSHOT_DIR ?? '/workspace'

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

test('settings, media library and inspector crop', async ({ page }) => {
  await signIn(page)

  await page.goto('/settings/ai')
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('API key')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible()
  await page.screenshot({ path: shot('settings-ai.png'), fullPage: true })

  await page.getByRole('link', { name: 'Media' }).click()
  await expect(page.getByRole('heading', { name: 'Media' })).toBeVisible({ timeout: 20_000 })
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#3a7' } }).png().toBuffer()
  await page.locator('input[type="file"]').setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('field.png').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('800 × 500')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: shot('media-library.png'), fullPage: true })

  await page.getByRole('link', { name: 'Pages' }).click()
  await page.getByRole('link', { name: 'Winter appeal' }).click()
  await expect(page.getByRole('heading', { name: 'Winter appeal' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Assistant' }).click()
  await expect(page.getByText(/The assistant isn't switched on yet/)).toBeVisible()
  await page.screenshot({ path: shot('editor-assistant.png'), fullPage: true })
  await page.screenshot({ path: shot('editor-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: /Hero/ }).first().click()
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible()
  await page.getByRole('button', { name: 'Change' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a photo' })).toBeVisible()
  await expect(page.getByText('field.png').first()).toBeVisible()
  await page.screenshot({ path: shot('editor-photo-change.png'), fullPage: true })
})
