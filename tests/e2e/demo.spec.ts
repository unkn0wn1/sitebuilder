import { expect, test, type BrowserContext, type Page } from 'playwright/test'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../shared/demo'
import { startDemoServer, type DemoServer } from './demo-server'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let demo: DemoServer

test.beforeAll(async () => {
  demo = await startDemoServer()
})

test.afterAll(async () => {
  await demo?.stop()
})

async function signIn(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/login`)
  await expect(page.getByText('skewstone-demo')).toBeVisible()
  await expect(page.getByText('Each visitor has their own copy')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveValue(DEMO_EMAIL)
  await expect(page.getByLabel('Password')).toHaveValue(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

async function retitle(context: BrowserContext, baseUrl: string, title: string) {
  const list = await context.request.get(`${baseUrl}/api/v1/pages`)
  expect(list.ok(), await list.text()).toBeTruthy()
  const body = (await list.json()) as { items: { id: string; path: string }[] }
  const home = body.items.find((item) => item.path === '/')
  expect(home).toBeTruthy()
  const page = await context.request.get(`${baseUrl}/api/v1/pages/${home!.id}`)
  expect(page.ok(), await page.text()).toBeTruthy()
  const revision = ((await page.json()) as { revision: number }).revision
  const edited = await context.request.post(`${baseUrl}/api/v1/pages/${home!.id}/ops`, {
    headers: { Origin: baseUrl },
    data: { baseRevision: revision, ops: [{ op: 'set_meta', title }] },
  })
  expect(edited.ok(), await edited.text()).toBeTruthy()
}

test('two visitors edit and reset only their own copy', async ({ browser }) => {
  const baseUrl = demo.baseUrl
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  try {
    await signIn(pageA, baseUrl)
    await signIn(pageB, baseUrl)
    await expect(pageA.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
    await expect(pageA.getByRole('button', { name: 'Reset demo' })).toBeVisible()
    await expect(pageA.getByText('Not reset yet')).toBeVisible()

    await retitle(contextA, baseUrl, 'Visitor A pantry')
    await retitle(contextB, baseUrl, 'Visitor B pantry')
    await pageA.reload()
    await pageB.reload()
    await expect(pageA.getByRole('heading', { name: 'Visitor A pantry' })).toBeVisible()
    await expect(pageA.getByRole('heading', { name: 'Visitor B pantry' })).toHaveCount(0)
    await expect(pageB.getByRole('heading', { name: 'Visitor B pantry' })).toBeVisible()
    await expect(pageB.getByRole('heading', { name: 'Visitor A pantry' })).toHaveCount(0)

    await pageA.getByRole('button', { name: 'Reset demo' }).click()
    await expect(pageA.getByRole('dialog')).toBeVisible()
    await expect(pageA.getByRole('heading', { name: 'Reset this demo' })).toBeVisible()
    await expect(pageA.getByText('Other visitors are not affected.')).toBeVisible()
    await pageA.getByRole('button', { name: 'Reset this demo' }).click()
    await expect(pageA.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
    await expect(pageA.getByRole('heading', { name: 'Fresh food for Riverside' })).toBeVisible()
    await expect(pageA.getByRole('heading', { name: 'Visitor A pantry' })).toHaveCount(0)
    await expect(pageA.getByText(/Last reset /)).toBeVisible()

    await pageB.reload()
    await expect(pageB.getByRole('heading', { name: 'Visitor B pantry' })).toBeVisible()
    await expect(pageB.getByRole('heading', { name: 'Fresh food for Riverside' })).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
