// Official catalogue over HTTP. The fixture key is generated here. This file never reads the real signing key.
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { readTarGz, writeTarGz } from '../../shared/plugins/archive'
import { buildRepositoryFiles, packSource, type BuiltPackage } from '../../shared/plugins/repo'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature, type OfficialKey } from '../../shared/plugins/signature'
import { Client } from './client'
import { ADMIN_EMAIL, lastEmail, PASSWORD, startServer, tokenFrom, type TestServer } from './server'

const official = join(dirname(fileURLToPath(import.meta.url)), '../../plugins/official')

const MSG_HASH = 'The archive does not match the repository index.'
const MSG_INVALID = 'The repository index signature is not valid.'
const MSG_UNSIGNED = 'The repository index is not signed.'
const MSG_HTTPS = 'The plugin repository must use https.'

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
    core: packed.manifest.sitebuilder,
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

function writeTree(dir: string, key: ReturnType<typeof keypair>) {
  for (const file of buildRepositoryFiles({ packages: repoFiles(key), privateKey: key.privateKey, publicKey: key.raw })) {
    const dest = join(dir, file.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, file.bytes)
  }
}

function flipHash(text: string): string {
  const next = text.replace(/"contentHash": "[0-9a-f]/, (match) => `${match.slice(0, -1)}${match.endsWith('0') ? '1' : '0'}`)
  if (next === text) throw new Error('content hash was not flipped')
  return next
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

function auditRows(dir: string, action: string): Record<string, unknown>[] {
  const db = new Database(join(dir, 'sitebuilder.db'))
  try {
    const rows = db.prepare('select details from audit_events where action = ?').all(action) as { details: string | null }[]
    return rows.map((row) => (row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {}))
  } finally {
    db.close()
  }
}

describe('plugin repository API', () => {
  const key = keypair()
  const root = mkdtempSync(join(tmpdir(), 'sb-repo-'))
  let fixture: { url: string; close(): Promise<void> }
  let server: TestServer
  let plain: TestServer
  let admin: Client
  let editor: Client

  beforeAll(async () => {
    writeTree(join(root, 'good'), key)
    writeTree(join(root, 'bad-archive'), key)
    writeTree(join(root, 'bad-index'), key)
    writeTree(join(root, 'missing-sig'), key)
    const archivePath = join(root, 'bad-archive/packages/match-thermometer/1.0.0/match-thermometer-1.0.0.tar.gz')
    const changed = readTarGz(readFileSync(archivePath)).files.map((file) =>
      file.path === 'thermometer.html' ? { path: file.path, bytes: Buffer.concat([file.bytes, Buffer.from(' ')]) } : file,
    )
    writeFileSync(archivePath, writeTarGz(changed))
    const indexPath = join(root, 'bad-index/index.json')
    writeFileSync(indexPath, flipHash(readFileSync(indexPath, 'utf8')))
    rmSync(join(root, 'missing-sig/index.json.sig'))
    fixture = await serve(root)
    const extra = JSON.stringify([key.listed])
    server = await startServer({
      SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS: '1',
      SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS: extra,
      SITEBUILDER_PLUGIN_REPO_URL: `${fixture.url}/good`,
      SITEBUILDER_PLUGIN_REPO_HTTP_HOST: '127.0.0.1',
    })
    plain = await startServer({
      SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS: '1',
      SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS: extra,
      SITEBUILDER_PLUGIN_REPO_URL: `${fixture.url}/good`,
      SITEBUILDER_PLUGIN_REPO_HTTP_HOST: '',
    })
    admin = new Client(server.baseUrl)
    await admin.login(ADMIN_EMAIL, PASSWORD)
    const invited = await admin.post('/users', { email: 'editor@example.org', name: 'Asha', role: 'editor' })
    if (invited.status !== 200) throw new Error(`invite editor: ${JSON.stringify(invited.body)}`)
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      await new Promise((res) => setTimeout(res, 100))
      try {
        token = tokenFrom(lastEmail(server.outbox, 'editor@example.org').text)
      } catch {
        token = ''
      }
    }
    if (!token) throw new Error('editor invite email did not arrive')
    const accepted = await new Client(server.baseUrl).post('/auth/invite/accept', { token, name: 'Asha', password: PASSWORD })
    if (accepted.status !== 200) throw new Error(`accept editor: ${JSON.stringify(accepted.body)}`)
    editor = new Client(server.baseUrl)
    await editor.login('editor@example.org', PASSWORD)
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await plain?.stop()
    await fixture?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('lists both official plugins for an admin', async () => {
    const listed = await admin.get('/plugins/repository')
    expect(listed.status).toBe(200)
    expect(listed.body.plugins.map((plugin: { id: string; compatible: boolean }) => [plugin.id, plugin.compatible])).toEqual([
      ['gift-tiers', true],
      ['match-thermometer', true],
    ])
    expect(listed.body.plugins[0].trust).toBeUndefined()
    expect(listed.body.repo).toBe(`${fixture.url}/good`)
  })

  it('refuses an editor', async () => {
    expect((await editor.get('/plugins/repository')).status).toBe(403)
    expect((await editor.post('/plugins/repository/install', { id: 'match-thermometer', version: '1.0.0' })).status).toBe(403)
  })

  it('refuses a tampered archive and leaves no plugin row', async () => {
    const refused = await admin.post('/plugins/repository/install', {
      id: 'match-thermometer',
      version: '1.0.0',
      repoUrl: `${fixture.url}/bad-archive`,
    })
    expect(refused.status).toBe(400)
    expect(refused.body.error.message).toBe(MSG_HASH)
    expect(refused.body.error.fields).toEqual([{ path: 'repository', message: MSG_HASH }])
    const rows = await admin.get('/plugins')
    expect(rows.status).toBe(200)
    expect(rows.body.plugins).toEqual([])
    expect(auditRows(server.dir, 'plugin.repo_rejected')).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'hash', pluginId: 'match-thermometer' })]))
  })

  it('refuses a tampered index', async () => {
    const refused = await admin.get(`/plugins/repository?repoUrl=${encodeURIComponent(`${fixture.url}/bad-index`)}`)
    expect(refused.status).toBe(400)
    expect(refused.body.error.message).toBe(MSG_INVALID)
  })

  it('refuses a missing index signature', async () => {
    const refused = await admin.get(`/plugins/repository?repoUrl=${encodeURIComponent(`${fixture.url}/missing-sig`)}`)
    expect(refused.status).toBe(400)
    expect(refused.body.error.message).toBe(MSG_UNSIGNED)
  })

  it('installs match-thermometer as Official and audits the repository', async () => {
    const installed = await admin.post('/plugins/repository/install', { id: 'match-thermometer', version: '1.0.0' })
    expect(installed.status).toBe(200)
    expect(installed.body).toMatchObject({ status: 'enabled', pluginId: 'match-thermometer', trust: 'official', version: '1.0.0' })
    const rows = await admin.get('/plugins')
    expect(rows.body.plugins).toEqual([expect.objectContaining({ pluginId: 'match-thermometer', trust: 'Official', version: '1.0.0' })])
    const origin = new URL(fixture.url).origin
    expect(auditRows(server.dir, 'plugin.installed')).toEqual([
      expect.objectContaining({ via: 'repository', repo: origin, trust: 'official', pluginId: 'match-thermometer' }),
    ])
    expect(origin.endsWith('/good')).toBe(false)
  })

  it('refuses http when the host pin is unset', async () => {
    const signedIn = new Client(plain.baseUrl)
    await signedIn.login(ADMIN_EMAIL, PASSWORD)
    const refused = await signedIn.get('/plugins/repository')
    expect(refused.status).toBe(400)
    expect(refused.body.error.message).toBe(MSG_HTTPS)
  })
})
