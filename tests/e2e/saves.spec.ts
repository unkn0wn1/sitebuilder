import { expect, test, type Page } from 'playwright/test'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'

const cloneErrors: string[] = []

async function signIn(page: Page) {
  cloneErrors.length = 0
  page.on('pageerror', (error) => {
    cloneErrors.push(error.message)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') cloneErrors.push(msg.text())
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

function expectNoCloneError() {
  const hits = cloneErrors.filter((text) => /DataCloneError|structuredClone|could not be cloned/i.test(text))
  expect(hits, hits.join('\n')).toEqual([])
}

async function expectSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 })
  expectNoCloneError()
}

test('brand menu look, site parts and settings all finish saving', async ({ page }) => {
  await signIn(page)

  await page.goto('/brand')
  await expect(page.getByRole('heading', { name: 'Brand and Design' })).toBeVisible({ timeout: 20_000 })
  await expectSaved(page)

  const looks = ['Classic bar', 'Centred logo', 'Mega menu', 'Hamburger'] as const
  for (const look of looks) {
    await page.getByRole('radio', { name: new RegExp(look) }).check()
    await expect(page.getByTestId('save-status')).toHaveText(/Saving|Saved/)
    await expectSaved(page)
  }

  await page.goto('/site-parts')
  await expect(page.getByRole('heading', { name: 'Site parts' })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('link', { name: 'Main menu' }).click()
  await expect(page.getByRole('heading', { name: 'Main menu' })).toBeVisible({ timeout: 20_000 })
  await expectSaved(page)
  await page.getByRole('button', { name: 'Add item' }).click()
  await expectSaved(page)
  await page.getByRole('button', { name: 'Remove' }).last().click()
  await expectSaved(page)

  await page.goto('/site-parts')
  await page.getByRole('link', { name: 'Header', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Header' })).toBeVisible({ timeout: 20_000 })
  await expectSaved(page)
  const menuLook = page.getByLabel('Menu look')
  const current = await menuLook.inputValue()
  const options = ['simple', 'centred', 'mega', 'hamburger']
  for (const value of options) {
    await menuLook.selectOption(value)
    await expectSaved(page)
  }
  if (options.includes(current)) await menuLook.selectOption(current)
  await expectSaved(page)

  await page.goto('/site-parts')
  await page.getByRole('link', { name: 'Footer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Footer' })).toBeVisible({ timeout: 20_000 })
  await expectSaved(page)
  const address = page.getByLabel('Address')
  const was = await address.inputValue()
  await address.fill(was ? `${was} ` : '12 Example Street')
  await expectSaved(page)
  await address.fill(was)
  await expectSaved(page)

  await page.goto('/settings/general')
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  expectNoCloneError()
})
