import { expect, test, type Page } from 'playwright/test'
import { mkdirSync } from 'node:fs'

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
})
