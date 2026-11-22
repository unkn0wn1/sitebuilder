import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from 'playwright/test'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'
const SITE_CSS = 'a { text-underline-offset: 0.15em; }'

function brandOpsSaved(page: Page, fragment: string) {
  return page.waitForResponse((res) => {
    if (!res.ok() || res.request().method() !== 'POST') return false
    if (!new URL(res.url()).pathname.endsWith('/api/v1/brand/ops')) return false
    return (res.request().postData() ?? '').includes(fragment)
  })
}

async function docsShot(page: Page, name: string, fullPage = true) {
  if (process.env.SB_SCREENSHOTS !== '1') return
  mkdirSync('docs/screenshots', { recursive: true })
  await page.screenshot({ path: `docs/screenshots/${name}`, fullPage })
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

async function expectSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 })
}

async function apiJson(page: Page, method: string, path: string, body?: unknown) {
  const origin = new URL(page.url()).origin
  const res = await page.request.fetch(path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: body,
  })
  const text = await res.text()
  expect(res.ok(), `${method} ${path} ${res.status()}: ${text}`).toBeTruthy()
  return text ? JSON.parse(text) : {}
}

function publishedHomeHtml(): string | null {
  const roots = [process.env.SITEBUILDER_SITE_ROOT, join(process.cwd(), '.data', 'site')].filter((p): p is string => !!p)
  for (const root of roots) {
    const current = join(root, 'current')
    const home = join(current, 'index.html')
    if (existsSync(home)) return readFileSync(home, 'utf8')
    // Seeded pages may live in a subfolder.
    if (existsSync(current)) {
      for (const name of readdirSync(current, { withFileTypes: true })) {
        if (!name.isDirectory()) continue
        const nested = join(current, name.name, 'index.html')
        if (existsSync(nested) && readFileSync(nested, 'utf8').includes('site-header')) {
          return readFileSync(nested, 'utf8')
        }
      }
    }
  }
  return null
}

async function enableSelfApproval(page: Page) {
  await apiJson(page, 'PATCH', '/api/v1/settings', { workflow: { selfApproval: true } })
}

async function publishAPage(page: Page) {
  const list = await apiJson(page, 'GET', '/api/v1/pages?search=Winter%20appeal&page=1&pageSize=10')
  const item = (list.items as { id: string; title: string; state: string; hasUnpublishedChanges: boolean }[])
    .find((p) => p.title === 'Winter appeal') ?? list.items[0]
  expect(item, 'seed should include a page to publish').toBeTruthy()
  if (item.state === 'published' && !item.hasUnpublishedChanges) {
    if (publishedHomeHtml()) return
  }
  const submitted = await apiJson(page, 'POST', `/api/v1/pages/${item.id}/submit`, {
    overrideReason: 'Needed so the brand look can render on a live page.',
  })
  await apiJson(page, 'POST', `/api/v1/reviews/${submitted.reviewId}/approve`, {
    versionId: submitted.versionId,
    overrideReason: 'Needed so the brand look can render on a live page.',
  })
  await expect.poll(() => (publishedHomeHtml() ? 'ready' : 'missing'), { timeout: 60_000 }).toBe('ready')
}

test('a brand change still publishes after leaving the page for approvals', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page)

  // A single admin can approve their own brand change in this flow.
  await enableSelfApproval(page)
  await publishAPage(page)

  await page.goto('/brand')
  await expect(page.getByRole('heading', { name: 'Brand and Design' })).toBeVisible({ timeout: 20_000 })
  await expectSaved(page)
  const cssCard = page.getByTestId('custom-css')
  await expect(cssCard.getByRole('heading', { name: 'Custom CSS (advanced)' })).toBeVisible()
  const cssSaved = brandOpsSaved(page, 'text-underline-offset')
  await cssCard.getByRole('textbox', { name: 'CSS' }).fill(SITE_CSS)
  await expect(page.getByTestId('save-status')).toHaveText('Saving…', { timeout: 15_000 })
  await cssSaved
  await expectSaved(page)
  await docsShot(page, 'custom-css-brand.png')
  // A status that was already Saved is not proof. The rule has to survive a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Brand and Design' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('custom-css').getByRole('textbox', { name: 'CSS' })).toHaveValue(SITE_CSS, { timeout: 15_000 })
  // The menu look now lives on the Header; the body font is a brand change that reaches every page.
  // The short rule above is part of this same brand draft. There is no second publish.
  const fontSaved = brandOpsSaved(page, 'Georgia, serif')
  await page.getByLabel('Body font').fill('Georgia, serif')
  await fontSaved
  await expectSaved(page)

  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await page.getByText('An approver will review this look').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByTestId('brand-status')).toHaveText(/Waiting for approval/, { timeout: 15_000 })

  // This is the navigation that used to flush the same draft and withdraw the review.
  await page.goto('/approvals')
  const reviewLink = page.locator('a[href^="/approvals/"]').filter({ hasText: 'Brand and Design' }).first()
  await expect(reviewLink).toBeVisible({ timeout: 15_000 })
  await reviewLink.click()
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Approve and publish' }).click()

  await expect.poll(() => {
    const html = publishedHomeHtml()
    if (!html) return 'missing'
    const georgia = html.includes('Georgia, serif')
    const underline = html.includes('text-underline-offset')
    if (georgia && underline) return 'ready'
    if (!georgia && !underline) return 'other'
    return georgia ? 'no-css' : 'no-font'
  }, { timeout: 60_000 }).toBe('ready')
})
