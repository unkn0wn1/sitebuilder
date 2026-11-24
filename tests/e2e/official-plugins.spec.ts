// Installs an Official plugin from a local fixture. The signing key is generated in this process.
// This spec does not open the real signing key and does not bind port 3010.
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from 'playwright/test'
import { buildRepositoryFiles, packSource, type BuiltPackage } from '../../shared/plugins/repo'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature, type OfficialKey } from '../../shared/plugins/signature'
import { ADMIN_EMAIL, PASSWORD, startServer, type TestServer } from '../api/server'

const official = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/official')

function keypair(): { privateKey: KeyObject; raw: Buffer; listed: OfficialKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawEd25519PublicKey(publicKey)
  return { privateKey, raw, listed: { id: officialKeyId(raw), publicKey: raw.toString('base64') } }
}

function repoFiles(key: ReturnType<typeof keypair>): BuiltPackage[] {
  return [packSource(join(official, 'match-thermometer')), packSource(join(official, 'gift-tiers'))].map((packed) => ({
    id: packed.manifest.id,
    name: packed.manifest.name,
    version: packed.manifest.version,
    core: packed.manifest.id === 'gift-tiers' ? '>=9.0.0 <10.0.0' : packed.manifest.sitebuilder,
    contentHash: packed.hash.hex,
    keyId: key.listed.id,
    archive: packed.archive,
    signature: signPluginSignature({
      privateKey: key.privateKey,
      publicKey: key.raw,
      contentHash: packed.hash.raw,
      pluginId: packed.manifest.id,
      version: packed.manifest.version,
    }),
  }))
}

function serve(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const rootPrefix = root.endsWith(sep) ? root : root + sep
  const server: Server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    const rel = raw.replace(/^\/+/, '')
    if (!rel || rel.includes('..') || rel.includes('\\')) {
      res.writeHead(404)
      res.end()
      return
    }
    const file = join(root, rel)
    if (!file.startsWith(rootPrefix) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200)
    res.end(readFileSync(file))
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('fixture port missing'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

async function apiJson(page: Page, base: string, method: string, path: string, body?: unknown): Promise<Record<string, any>> {
  const res = await page.request.fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    data: body,
  })
  const text = await res.text()
  expect(res.ok(), `${method} ${path} ${res.status()} ${text}`).toBeTruthy()
  return text ? (JSON.parse(text) as Record<string, any>) : {}
}

async function waitJob(page: Page, base: string, id: string) {
  const end = Date.now() + 60_000
  for (;;) {
    const job = await apiJson(page, base, 'GET', `/jobs/${id}`)
    if (job.state === 'done') return
    if (job.state === 'failed') throw new Error(typeof job.lastError === 'string' ? job.lastError : 'publish failed')
    if (Date.now() > end) throw new Error(`job ${id} still ${String(job.state)}`)
    await page.waitForTimeout(200)
  }
}

async function signIn(page: Page, base: string) {
  await page.goto(`${base}/login`)
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

function catalogue(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Add from the Skewstone repository', exact: true }) })
}

async function previewHtml(page: Page): Promise<string> {
  const frames = page.locator('iframe[title="Page preview"]')
  const count = await frames.count()
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const frame = await frames.nth(i).contentFrame()
    if (!frame) continue
    const html = await frame.locator('html').evaluate((el) => el.outerHTML).catch(() => '')
    if (html) parts.push(html)
  }
  return parts.join('\n')
}

test.describe('official plugin catalogue', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  const key = keypair()
  const root = mkdtempSync(join(tmpdir(), 'sb-e2e-repo-'))
  const repoDir = join(root, 'repo')
  let fixture: { url: string; close(): Promise<void> }
  let server: TestServer

  test.beforeAll(async () => {
    for (const file of buildRepositoryFiles({ packages: repoFiles(key), privateKey: key.privateKey, publicKey: key.raw })) {
      const dest = join(repoDir, file.path)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, file.bytes)
    }
    fixture = await serve(root)
    server = await startServer({
      SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS: '1',
      SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS: JSON.stringify([key.listed]),
      SITEBUILDER_PLUGIN_REPO_URL: `${fixture.url}/repo`,
      SITEBUILDER_PLUGIN_REPO_HTTP_HOST: '127.0.0.1',
    })
  })

  test.afterAll(async () => {
    await server?.stop()
    await fixture?.close()
    rmSync(root, { recursive: true, force: true })
  })

  test('installs the match thermometer, previews it, and publishes it', async ({ page }) => {
    test.setTimeout(120_000)
    const base = server.baseUrl
    await signIn(page, base)
    await page.goto(`${base}/settings/plugins`)
    const section = catalogue(page)
    await expect(section.getByRole('heading', { name: 'Add from the Skewstone repository' })).toBeVisible({ timeout: 20_000 })
    const gift = section.locator('article').filter({ hasText: 'gift-tiers' })
    await expect(gift).toContainText('Official')
    await expect(gift).toContainText('This plugin needs a different Skewstone version.')
    await expect(gift.getByRole('button', { name: 'Install' })).toBeDisabled()
    const match = section.locator('article').filter({ hasText: 'match-thermometer' })
    await expect(match).toContainText('Official')
    await expect(match).toContainText('Content hash')
    await match.getByRole('button', { name: 'Install' }).click()
    await expect(page.getByText('Installed and turned on.')).toBeVisible({ timeout: 20_000 })
    const installed = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Match thermometer', exact: true }) })
    await expect(installed).toContainText('match-thermometer, version 1.0.0, Official')

    await apiJson(page, base, 'PATCH', '/settings', { workflow: { selfApproval: true } })
    const templates = await apiJson(page, base, 'GET', '/templates')
    const items = templates.items as { id: string; key: string }[]
    const standard = items.find((item) => item.key === 'standard')
    expect(standard).toBeTruthy()
    const current = await apiJson(page, base, 'GET', `/templates/${standard!.id}`)
    const doc = current.doc as { allowedBlocks: string[] }
    doc.allowedBlocks = [...doc.allowedBlocks, 'match-thermometer/Thermometer']
    await apiJson(page, base, 'POST', `/templates/${standard!.id}/ops`, { baseRevision: current.revision, ops: [{ op: 'replace', doc }] })
    const submittedType = await apiJson(page, base, 'POST', `/templates/${standard!.id}/submit`, {})
    const approvedType = await apiJson(page, base, 'POST', `/reviews/${submittedType.reviewId}/approve`, { versionId: submittedType.versionId })
    await waitJob(page, base, String(approvedType.jobId))

    const created = await apiJson(page, base, 'POST', '/pages', { title: 'Match page', template: 'standard', slug: 'match-page' })
    const pageId = String((created.page as { id: string }).id)
    await page.goto(`${base}/pages/${pageId}`)
    await expect(page.getByRole('heading', { name: 'Match page' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const pluginButton = page.getByRole('button', { name: 'Match thermometer' }).filter({ hasText: 'Official' })
    await expect(pluginButton).toBeVisible({ timeout: 20_000 })
    await pluginButton.click()
    await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 20_000 })
    await expect.poll(() => previewHtml(page), { timeout: 20_000 }).toContain('Match so far')

    const submitted = await apiJson(page, base, 'POST', `/pages/${pageId}/submit`, {})
    const approved = await apiJson(page, base, 'POST', `/reviews/${submitted.reviewId}/approve`, { versionId: submitted.versionId })
    await waitJob(page, base, String(approved.jobId))
    const published = join(server.dir, 'current', 'match-page', 'index.html')
    await expect.poll(() => (existsSync(published) ? readFileSync(published, 'utf8') : ''), { timeout: 20_000 }).toContain('Match so far')
    const html = readFileSync(published, 'utf8')
    expect(html).toContain('y="159"')
    expect(html).toContain('height="145"')
  })

  test('refuses a tampered index in the catalogue', async ({ page }) => {
    const indexPath = join(repoDir, 'index.json')
    const text = readFileSync(indexPath, 'utf8')
    const flipped = text.replace(/"contentHash": "[0-9a-f]/, (match) => `${match.slice(0, -1)}${match.endsWith('0') ? '1' : '0'}`)
    expect(flipped).not.toBe(text)
    writeFileSync(indexPath, flipped)
    const base = server.baseUrl
    await signIn(page, base)
    await page.goto(`${base}/settings/plugins`)
    const section = catalogue(page)
    await expect(section.getByText('The repository index signature is not valid.')).toBeVisible({ timeout: 20_000 })
    await expect(section.getByRole('button', { name: 'Install' })).toHaveCount(0)
    await expect(section.getByText('Official')).toHaveCount(0)
  })
})
