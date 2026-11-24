import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditEvents, plugins } from '../server/db/schema'
import { AppError } from '../server/services/errors'
import { installFromRepository, listRepository, MSG_CORE, MSG_FETCH, MSG_HASH, MSG_HTTPS, MSG_INVALID, MSG_OVERSIZE, MSG_PATH, MSG_TIMEOUT, MSG_UNKNOWN, MSG_UNSIGNED, repositoryBase, assertRepoUrl, type FetchDeps } from '../server/services/plugins/repository'
import { readTarGz, writeTarGz } from '../shared/plugins/archive'
import { buildRepositoryFiles, canonicalIndex, packSource, type BuiltPackage, type IndexEntry } from '../shared/plugins/repo'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature, type OfficialKey } from '../shared/plugins/signature'
import { setup } from './helpers'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const official = join(dirname(fileURLToPath(import.meta.url)), '../plugins/official')
const BASE = 'http://127.0.0.1:9/repo'

function keypair(): { privateKey: KeyObject; raw: Buffer; listed: OfficialKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawEd25519PublicKey(publicKey)
  return { privateKey, raw, listed: { id: officialKeyId(raw), publicKey: raw.toString('base64') } }
}

function built(key: ReturnType<typeof keypair>, coreFor?: (id: string, core: string) => string): { packages: BuiltPackage[]; files: Map<string, Buffer> } {
  const match = packSource(join(official, 'match-thermometer'))
  const gift = packSource(join(official, 'gift-tiers'))
  const packages = [match, gift].map((packed) => ({
    id: packed.manifest.id,
    name: packed.manifest.name,
    version: packed.manifest.version,
    core: coreFor ? coreFor(packed.manifest.id, packed.manifest.sitebuilder) : packed.manifest.sitebuilder,
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
  const files = new Map<string, Buffer>()
  for (const file of buildRepositoryFiles({ packages, privateKey: key.privateKey, publicKey: key.raw })) {
    files.set(new URL(file.path, `${BASE}/`).pathname, file.bytes)
  }
  return { packages, files }
}

function deps(files: Map<string, Buffer>, resolve: FetchDeps['resolve'] = async () => ['93.184.216.34']): FetchDeps & { seen: string[] } {
  const seen: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    seen.push(url.toString())
    const body = files.get(url.pathname)
    if (!body) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(body))
  }
  return { fetch: fetchImpl, resolve, seen }
}

function useKey(key: OfficialKey) {
  process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS = '1'
  process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS = JSON.stringify([key])
  process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST = '127.0.0.1'
  process.env.SITEBUILDER_PLUGIN_REPO_URL = BASE
}

const closers: Array<{ close(): void }> = []

afterEach(() => {
  for (const db of closers.splice(0)) db.close()
  delete process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS
  delete process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS
  delete process.env.SITEBUILDER_PLUGIN_REPO_URL
  delete process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST
})

describe('repository address policy', () => {
  it('ignores an override unless the test-key flag is on', () => {
    delete process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS
    delete process.env.SITEBUILDER_PLUGIN_REPO_URL
    expect(repositoryBase('http://127.0.0.1:9/other')).toBe('https://plugins.skewstone.com')
    process.env.SITEBUILDER_PLUGIN_REPO_URL = 'https://example.org/plugins/'
    expect(repositoryBase('http://127.0.0.1:9/other')).toBe('https://example.org/plugins')
    process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS = '1'
    expect(repositoryBase('http://127.0.0.1:9/other/')).toBe('http://127.0.0.1:9/other')
    expect(repositoryBase('   ')).toBe('https://example.org/plugins')
  })

  it('allows http only for the pinned loopback or private host', () => {
    delete process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST
    expect(() => assertRepoUrl('http://127.0.0.1/index.json')).toThrow(MSG_HTTPS)
    expect(() => assertRepoUrl('file:///tmp/index.json')).toThrow(MSG_HTTPS)
    expect(() => assertRepoUrl('https://user:pass@example.org/index.json')).toThrow(MSG_HTTPS)
    expect(() => assertRepoUrl('https://127.0.0.1/index.json')).toThrow(MSG_FETCH)
    process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST = '8.8.8.8'
    expect(() => assertRepoUrl('http://8.8.8.8/index.json')).toThrow(MSG_HTTPS)
    process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST = '127.0.0.1'
    expect(assertRepoUrl('http://127.0.0.1:9/repo/index.json')).toBe('http://127.0.0.1:9/repo/index.json')
    expect(() => assertRepoUrl('http://10.0.0.8/index.json')).toThrow(MSG_HTTPS)
    process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST = 'localhost'
    expect(assertRepoUrl('http://localhost:9/index.json')).toBe('http://localhost:9/index.json')
  })
})

describe('signed index fetch', () => {
  it('lists official plugins and marks a core mismatch', async () => {
    const key = keypair()
    useKey(key.listed)
    const { files } = built(key, (id, core) => (id === 'gift-tiers' ? '>=9.0.0 <10.0.0' : core))
    const listed = await listRepository(BASE, deps(files))
    expect(listed.repo).toBe(BASE)
    expect(listed.plugins.map((plugin) => plugin.id)).toEqual(['gift-tiers', 'match-thermometer'])
    const gift = listed.plugins.find((plugin) => plugin.id === 'gift-tiers')
    const match = listed.plugins.find((plugin) => plugin.id === 'match-thermometer')
    expect(gift?.compatible).toBe(false)
    expect(match?.compatible).toBe(true)
    expect(match?.keyId).toBe(key.listed.id)
    expect(Object.keys(match ?? {})).not.toContain('trust')
  })

  it('ignores the extra key when the test flag is off', async () => {
    const key = keypair()
    process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS = JSON.stringify([key.listed])
    process.env.SITEBUILDER_PLUGIN_REPO_HTTP_HOST = '127.0.0.1'
    process.env.SITEBUILDER_PLUGIN_REPO_URL = BASE
    delete process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS
    const { files } = built(key)
    await expect(listRepository(undefined, deps(files))).rejects.toMatchObject({ message: MSG_UNKNOWN })
  })

  it('refuses a missing signature, a bad signature, an unknown key, and a bad path', async () => {
    const key = keypair()
    const other = keypair()
    useKey(key.listed)
    const { files } = built(key)
    const missing = new Map(files)
    missing.delete('/repo/index.json.sig')
    await expect(listRepository(BASE, deps(missing))).rejects.toMatchObject({ message: MSG_UNSIGNED })

    const index = files.get('/repo/index.json')
    expect(index).toBeTruthy()
    const flipped = Buffer.from(index!.toString('utf8').replace(/"contentHash": "[0-9a-f]/, (match) => `${match.slice(0, -1)}${match.endsWith('0') ? '1' : '0'}`))
    expect(flipped.equals(index!)).toBe(false)
    const tampered = new Map(files)
    tampered.set('/repo/index.json', flipped)
    await expect(listRepository(BASE, deps(tampered))).rejects.toMatchObject({ message: MSG_INVALID })

    const foreign = new Map<string, Buffer>()
    for (const file of buildRepositoryFiles({ packages: built(other).packages, privateKey: other.privateKey, publicKey: other.raw })) {
      foreign.set(new URL(file.path, `${BASE}/`).pathname, file.bytes)
    }
    await expect(listRepository(BASE, deps(foreign))).rejects.toMatchObject({ message: MSG_UNKNOWN })

    const entry: IndexEntry = {
      id: 'match-thermometer',
      version: '1.0.0',
      contentHash: 'a'.repeat(64),
      archive: 'packages/../match-thermometer/1.0.0/match-thermometer-1.0.0.tar.gz',
      signature: 'packages/../match-thermometer/1.0.0/match-thermometer-1.0.0.tar.gz.sig',
      keyId: 'a'.repeat(16),
      core: '>=0.1.0 <0.2.0',
    }
    const escaped = new Map(files)
    escaped.set('/repo/index.json', Buffer.from(canonicalIndex([entry])))
    await expect(listRepository(BASE, deps(escaped))).rejects.toMatchObject({ message: MSG_PATH })
  })

  it('stops a redirect onto a private host and a file that is too big', async () => {
    process.env.SITEBUILDER_PLUGIN_REPO_URL = 'https://example.org/plugins'
    const redirected: FetchDeps = {
      resolve: async () => ['93.184.216.34'],
      fetch: async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/index.json' } }),
    }
    await expect(listRepository(undefined, redirected)).rejects.toMatchObject({ message: MSG_FETCH })

    const huge: FetchDeps = {
      resolve: async () => ['93.184.216.34'],
      fetch: async () => new Response(new Uint8Array(256 * 1024 + 1)),
    }
    await expect(listRepository(undefined, huge)).rejects.toMatchObject({ message: MSG_OVERSIZE })

    const slow: FetchDeps = {
      resolve: async () => ['93.184.216.34'],
      fetch: async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      },
    }
    await expect(listRepository(undefined, slow)).rejects.toMatchObject({ message: MSG_TIMEOUT })
  })
})

describe('install from the repository', () => {
  it('refuses a core mismatch before downloading the archive', async () => {
    const key = keypair()
    useKey(key.listed)
    const s = setup()
    closers.push(s.sqlite)
    const { files } = built(key, (id, core) => (id === 'gift-tiers' ? '>=9.0.0 <10.0.0' : core))
    const client = deps(files)
    await expect(installFromRepository(s.ctx, s.admin, { id: 'gift-tiers', version: '1.0.0', repoUrl: BASE }, client)).rejects.toMatchObject({ message: MSG_CORE, code: 'validation_failed' })
    expect(client.seen.some((url) => url.endsWith('.tar.gz'))).toBe(false)
    expect(s.ctx.db.select().from(plugins).all()).toEqual([])
    const rejected = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.repo_rejected')).all()
    expect(rejected.map((row) => row.details)).toEqual([expect.objectContaining({ pluginId: 'gift-tiers', version: '1.0.0', reason: 'core' })])
  })

  it('refuses a tampered archive and does not install it', async () => {
    const key = keypair()
    useKey(key.listed)
    const s = setup()
    closers.push(s.sqlite)
    const { files } = built(key)
    const archivePath = '/repo/packages/match-thermometer/1.0.0/match-thermometer-1.0.0.tar.gz'
    const archive = files.get(archivePath)
    expect(archive).toBeTruthy()
    const changed = readTarGz(archive!).files.map((file) => (file.path === 'thermometer.html' ? { path: file.path, bytes: Buffer.concat([file.bytes, Buffer.from(' ')]) } : file))
    files.set(archivePath, writeTarGz(changed))
    await expect(installFromRepository(s.ctx, s.admin, { id: 'match-thermometer', version: '1.0.0', repoUrl: BASE }, deps(files))).rejects.toBeInstanceOf(AppError)
    await expect(installFromRepository(s.ctx, s.admin, { id: 'match-thermometer', version: '1.0.0', repoUrl: BASE }, deps(files))).rejects.toMatchObject({ message: MSG_HASH })
    expect(s.ctx.db.select().from(plugins).all()).toEqual([])
  })

  it('installs an official package and records the repository origin', async () => {
    const key = keypair()
    useKey(key.listed)
    const s = setup()
    closers.push(s.sqlite)
    const { files } = built(key)
    await expect(installFromRepository(s.ctx, s.editor, { id: 'match-thermometer', version: '1.0.0', repoUrl: BASE }, deps(files))).rejects.toMatchObject({ code: 'forbidden' })
    const installed = await installFromRepository(s.ctx, s.admin, { id: 'match-thermometer', version: '1.0.0', repoUrl: BASE }, deps(files))
    expect(installed).toMatchObject({ status: 'enabled', pluginId: 'match-thermometer', trust: 'official', version: '1.0.0' })
    const row = s.ctx.db.select().from(plugins).where(eq(plugins.pluginId, 'match-thermometer')).get()
    expect(row?.trust).toBe('official')
    const audit = s.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plugin.installed')).all()
    expect(audit.map((event) => event.details)).toEqual([
      expect.objectContaining({ via: 'repository', repo: 'http://127.0.0.1:9', trust: 'official', pluginId: 'match-thermometer' }),
    ])
  })
})
