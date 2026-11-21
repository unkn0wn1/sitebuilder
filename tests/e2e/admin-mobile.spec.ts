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

async function assertNoHorizontalOverflow(page: Page) {
  const measure = await page.evaluate(() => {
    const root = document.documentElement
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }
  })
  expect(measure.scrollWidth, `document scrolled horizontally (${measure.scrollWidth} > ${measure.clientWidth})`).toBeLessThanOrEqual(measure.clientWidth + 1)
}

function shot(name: string) {
  mkdirSync(screenshotDir, { recursive: true })
  return `${screenshotDir}/${name}`
}

const mobile = { width: 375, height: 812 }

async function navigate(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Open the menu' }).click()
  const nav = page.getByRole('navigation', { name: 'Builder' })
  await expect(nav).toBeInViewport()
  await nav.getByRole('link', { name }).click()
  await expect(nav).not.toBeInViewport()
}

async function visitReviewFlows(page: Page, scheme: 'light' | 'dark') {
  // Phones get a top bar; the navigation opens as a sheet.
  await expect(page.getByRole('button', { name: 'Open the menu' })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: shot(`admin-mobile-pages-${scheme}.png`), fullPage: true })

  await page.getByRole('button', { name: 'Open the menu' }).click()
  const nav = page.getByRole('navigation', { name: 'Builder' })
  await expect(nav).toBeInViewport()
  await page.screenshot({ path: shot(`admin-mobile-nav-${scheme}.png`) })
  await nav.getByRole('link', { name: /Approvals/ }).click()
  await expect(nav).not.toBeInViewport()
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible({ timeout: 20_000 })
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: shot(`admin-mobile-approvals-${scheme}.png`), fullPage: true })

  const reviewLink = page.locator('a[href^="/approvals/"]').first()
  if (await reviewLink.count()) {
    await reviewLink.click()
    await expect(page.getByRole('heading', { name: /Review:/ })).toBeVisible({ timeout: 20_000 })
    await assertNoHorizontalOverflow(page)
    await page.screenshot({ path: shot(`admin-mobile-review-${scheme}.png`), fullPage: true })
    await navigate(page, /Approvals/)
  }

  await navigate(page, /^Pages$/)
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
  const winter = page.getByRole('link', { name: 'Winter appeal' })
  await expect(winter).toBeVisible()
  await winter.click()
  await expect(page.getByRole('heading', { name: 'Winter appeal' })).toBeVisible({ timeout: 20_000 })
  await assertNoHorizontalOverflow(page)
  await page.getByTestId('mobile-sections').click()
  await expect(page.getByRole('button', { name: 'Outline' })).toBeVisible()
  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: /Hero/ }).first().click()
  await expect(page.getByTestId('mobile-edit-fields')).toBeVisible()
  await page.getByTestId('mobile-edit-fields').click()
  await expect(page.getByTestId('mobile-section-fields')).toBeVisible()
  await assertNoHorizontalOverflow(page)
  await page.screenshot({ path: shot(`admin-mobile-editor-${scheme}.png`), fullPage: true })

  if (await page.getByRole('button', { name: 'Submit for approval' }).count()) {
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    const issues = page.getByTestId('submit-issues')
    if (await issues.isVisible().catch(() => false)) {
      await assertNoHorizontalOverflow(page)
      await page.screenshot({ path: shot(`admin-mobile-validation-${scheme}.png`), fullPage: true })
    }
  }
}

test.describe('admin mobile review flows', () => {
  test.use({ viewport: mobile })

  test('does not overflow at 375px in light appearance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await signIn(page)
    await visitReviewFlows(page, 'light')
  })

  test('does not overflow at 375px in dark appearance', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await signIn(page)
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 10_000 })
    await visitReviewFlows(page, 'dark')
  })
})
