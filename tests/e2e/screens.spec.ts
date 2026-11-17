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


test('site parts list, menu, header and footer', async ({ page }) => {
  await signIn(page)

  await page.goto('/site-parts')
  await expect(page.getByRole('heading', { name: 'Site parts' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Main menu' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Header', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Footer', exact: true })).toBeVisible()
  await page.screenshot({ path: shot('menus.png'), fullPage: true })

  await page.getByRole('link', { name: 'Main menu' }).click()
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible()
  await expect(page.getByText('Preview')).toBeVisible()
  await page.screenshot({ path: shot('menu-editor.png'), fullPage: true })

  await page.goto('/site-parts')
  await page.getByRole('link', { name: 'Header', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Header' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Menu')).toBeVisible()
  await expect(page.getByLabel('Menu look')).toHaveCount(0)
  await expect(page.getByText(/Menu look is set in/).getByRole('link', { name: 'Brand and Design' })).toBeVisible()
  await page.screenshot({ path: shot('header-editor.png'), fullPage: true })

  await page.goto('/site-parts')
  await page.getByRole('link', { name: 'Footer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Footer' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Email')).toBeVisible()
  await page.screenshot({ path: shot('footer-editor.png'), fullPage: true })
})


test('approvals list and review', async ({ page }) => {
  await signIn(page)

  const list = await page.request.get('/api/v1/pages?search=Winter%20appeal&page=1&pageSize=10')
  expect(list.ok()).toBeTruthy()
  const winter = ((await list.json()) as { items: { id: string; title: string }[] }).items.find((p) => p.title === 'Winter appeal')
  expect(winter).toBeTruthy()
  const submitted = await page.evaluate(async (pageId) => {
    const res = await fetch(`/api/v1/pages/${pageId}/submit`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Ready for the winter campaign.', overrideReason: 'The demo page has no donation form yet.' }),
    })
    return { ok: res.ok, status: res.status, body: await res.json() }
  }, winter!.id)
  expect(submitted.ok, JSON.stringify(submitted.body)).toBeTruthy()

  await page.goto('/approvals')
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Winter appeal' })).toBeVisible()
  await page.screenshot({ path: shot('approvals.png'), fullPage: true })

  await page.getByRole('link', { name: 'Winter appeal' }).click()
  await expect(page.getByRole('heading', { name: /Review: Winter appeal/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send back' })).toBeVisible()
  await expect(page.getByText("Ready for the winter campaign.")).toBeVisible()
  await page.screenshot({ path: shot('review.png'), fullPage: true })
})


test('brand and design', async ({ page }) => {
  await signIn(page)
  await page.goto('/brand')
  await expect(page.getByRole('heading', { name: 'Brand and Design' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Colours' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Menu look' })).toBeVisible()
  await expect(page.getByText('Classic bar', { exact: true })).toBeVisible()
  await expect(page.getByText('Hamburger', { exact: true })).toBeVisible()
  await page.screenshot({ path: shot('brand.png'), fullPage: true })
  await page.getByRole('radio', { name: /Hamburger/ }).check()
  await expect(page.getByText('Menu', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: shot('brand-hamburger.png'), fullPage: true })
})


test('page types and the rest of settings', async ({ page }) => {
  await signIn(page)

  await page.goto('/templates')
  await expect(page.getByRole('heading', { name: 'Page types' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Campaign' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Standard' })).toBeVisible()
  await page.screenshot({ path: shot('page-types.png'), fullPage: true })

  await page.getByRole('link', { name: 'Campaign' }).click()
  await expect(page.getByRole('heading', { name: 'Campaign' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Allowed and required sections')).toBeVisible()
  await page.screenshot({ path: shot('page-type-editor.png'), fullPage: true })

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'General' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workflow' })).toBeVisible()
  await page.screenshot({ path: shot('settings.png'), fullPage: true })

  await page.goto('/settings/general')
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Site name')).toBeVisible()
  await page.screenshot({ path: shot('settings-general.png'), fullPage: true })

  await page.goto('/settings/workflow')
  await expect(page.getByRole('heading', { name: 'Workflow', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Allow people to approve their own changes')).toBeVisible()
  await page.screenshot({ path: shot('settings-workflow.png'), fullPage: true })

  await page.goto('/settings/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Cloudflare' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Google Workspace email' })).toBeVisible()
  await page.screenshot({ path: shot('settings-integrations.png'), fullPage: true })

  await page.goto('/settings/users')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible()
  await page.screenshot({ path: shot('settings-users.png'), fullPage: true })
})
