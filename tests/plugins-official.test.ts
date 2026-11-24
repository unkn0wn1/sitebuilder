import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { installPluginArchive } from '../server/services/plugins/install'
import { testRenderPlugin } from '../server/services/plugins/render-check'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature, type OfficialKey } from '../shared/plugins/signature'
import {
  buildRepositoryFiles,
  canonicalIndex,
  packSource,
  parseCanonicalIndex,
  verifyIndexSignature,
} from '../shared/plugins/repo'
import { emptyPageDoc } from '../shared/page'
import { setup } from './helpers'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const official = join(repo, 'plugins', 'official')

function keypair(): { privateKey: KeyObject; raw: Buffer; listed: OfficialKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawEd25519PublicKey(publicKey)
  return { privateKey, raw, listed: { id: officialKeyId(raw), publicKey: raw.toString('base64') } }
}

function childEnv(extra: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.SITEBUILDER_PLUGIN_SIGNING_KEY
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(repo, 'scripts', script), ...args], {
    cwd: repo,
    env,
    encoding: 'utf8',
  })
}

function assertPublicLines(stdout: string) {
  expect(stdout).toMatch(/^publicKey: [A-Za-z0-9+/]{43}=\nkeyId: [0-9a-f]{16}\n$/)
  expect(stdout.includes('PRIVATE')).toBe(false)
  expect(stdout.includes('BEGIN')).toBe(false)
}

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS
  delete process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS
})

describe('official plugin sources', () => {
  it('renders the match thermometer and the gift tiers from the source tree', async () => {
    const match = packSource(join(official, 'match-thermometer'))
    const gift = packSource(join(official, 'gift-tiers'))
    expect(match.manifest.id).toBe('match-thermometer')
    expect(match.manifest.blocks[0]?.type).toBe('Thermometer')
    expect(match.manifest.blocks[0]?.money).toBe(true)
    expect(gift.manifest.id).toBe('gift-tiers')
    expect(gift.manifest.blocks[0]?.type).toBe('Tiers')
    expect(`${gift.manifest.id}/${gift.manifest.blocks[0]?.type}`).toBe('gift-tiers/Tiers')
    const drawn = await testRenderPlugin({ manifest: match.manifest, files: match.files })
    const giftDrawn = await testRenderPlugin({ manifest: gift.manifest, files: gift.files })
    expect(drawn.ok).toBe(true)
    expect(giftDrawn.ok).toBe(true)
    if (!drawn.ok || !giftDrawn.ok) return
    const { renderPageHtml } = await import('../server/services/render')
    const doc = emptyPageDoc('Match')
    doc.blocks = [{ id: 'b_match0001', type: 'match-thermometer/Thermometer', v: 1, props: match.manifest.blocks[0]!.example }]
    const html = await renderPageHtml({
      doc,
      pageId: 'pg_plugincheck',
      versionId: 'ver_plugincheck',
      path: '/plugin-check',
      site: {
        name: 'Plugin check',
        origin: 'https://example.org',
        titlePattern: '{page}',
        allowIndexing: false,
        defaultSocialImage: null,
        tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
        header: null,
        footer: null,
        banner: null,
        menus: {},
        pagesById: {},
        media: {},
        embeds: {},
        pluginBlocks: { 'match-thermometer/Thermometer': drawn.blocks[0]! },
      },
    })
    expect(html.html).toContain('Match so far')
    expect(html.html).toContain('y="159"')
    expect(html.html).toContain('height="145"')
    const giftDoc = emptyPageDoc('Gifts')
    giftDoc.blocks = [{ id: 'b_gift00001', type: 'gift-tiers/Tiers', v: 1, props: gift.manifest.blocks[0]!.example }]
    const gifts = await renderPageHtml({
      doc: giftDoc,
      pageId: 'pg_plugincheck',
      versionId: 'ver_plugincheck',
      path: '/plugin-check',
      site: {
        name: 'Plugin check',
        origin: 'https://example.org',
        titlePattern: '{page}',
        allowIndexing: false,
        defaultSocialImage: null,
        tracking: { ga4: null, gtm: null, plausible: null, cookiebot: null },
        header: null,
        footer: null,
        banner: null,
        menus: {},
        pagesById: {},
        media: {},
        embeds: {},
        pluginBlocks: { 'gift-tiers/Tiers': giftDrawn.blocks[0]! },
      },
    })
    expect(gifts.html).toContain('Ways to give')
    expect(gifts.html).toContain('£25')
    expect(gifts.html).toContain('Blanket')
  })

  it('signs a canonical index and refuses a bad one', () => {
    const key = keypair()
    const other = keypair()
    const match = packSource(join(official, 'match-thermometer'))
    const gift = packSource(join(official, 'gift-tiers'))
    const signatureFor = (packed: ReturnType<typeof packSource>) =>
      signPluginSignature({
        privateKey: key.privateKey,
        publicKey: key.raw,
        contentHash: packed.hash.raw,
        pluginId: packed.manifest.id,
        version: packed.manifest.version,
      })
    const files = buildRepositoryFiles({
      privateKey: key.privateKey,
      publicKey: key.raw,
      packages: [match, gift].map((packed) => ({
        id: packed.manifest.id,
        name: packed.manifest.name,
        version: packed.manifest.version,
        core: packed.manifest.sitebuilder,
        contentHash: packed.hash.hex,
        keyId: key.listed.id,
        archive: packed.archive,
        signature: signatureFor(packed),
      })),
    })
    const index = files.find((file) => file.path === 'index.json')!.bytes
    const sig = files.find((file) => file.path === 'index.json.sig')!.bytes.toString('utf8')
    const parsed = parseCanonicalIndex(index)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.plugins.map((plugin) => plugin.id)).toEqual(['gift-tiers', 'match-thermometer'])
    expect(verifyIndexSignature(sig, parsed.canonical, [key.listed])).toEqual({ ok: true, keyId: key.listed.id })
    expect(verifyIndexSignature(null, parsed.canonical, [key.listed])).toEqual({ ok: false, reason: 'unsigned' })
    expect(verifyIndexSignature('not a signature', parsed.canonical, [key.listed])).toEqual({ ok: false, reason: 'invalid' })
    const flipped = sig.replace(/A/g, 'B').replace(/B/g, 'C')
    expect(verifyIndexSignature(flipped, parsed.canonical, [key.listed]).ok).toBe(false)
    expect(verifyIndexSignature(sig, parsed.canonical, [other.listed])).toEqual({ ok: false, reason: 'unknown-key' })
    expect(verifyIndexSignature(sig, parsed.canonical, [])).toEqual({ ok: false, reason: 'unknown-key' })
    const escaped = canonicalIndex(parsed.plugins).replace('packages/gift-tiers/', 'packages/../gift-tiers/')
    expect(parseCanonicalIndex(Buffer.from(escaped))).toEqual({ ok: false, reason: 'path' })
    expect(files.some((file) => file.path === 'index.html' && !file.bytes.includes(Buffer.from('<script')))).toBe(true)
  })
})

describe('plugin keygen', () => {
  it('writes a 0o600 key outside the repo and prints only the public key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-key-'))
    temps.push(dir)
    const keyFile = join(dir, 'official-signing.key')
    const previous = process.umask(0)
    let made: ReturnType<typeof runScript>
    try {
      made = runScript('plugin-keygen.ts', [], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    } finally {
      process.umask(previous)
    }
    expect(made.status, made.stderr).toBe(0)
    assertPublicLines(made.stdout)
    expect(made.stderr.includes('PRIVATE')).toBe(false)
    expect(made.stderr.includes('BEGIN')).toBe(false)
    expect(statSync(keyFile).mode & 0o777).toBe(0o600)
    const again = runScript('plugin-keygen.ts', [], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    expect(again.status).toBe(2)
    expect(again.stderr).toContain('Refusing to overwrite')
    expect(again.stdout).toBe('')
    const shown = runScript('plugin-keygen.ts', ['--public'], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    expect(shown.status, shown.stderr).toBe(0)
    expect(shown.stdout).toBe(made.stdout)
    expect(shown.stdout.includes('PRIVATE')).toBe(false)
  })

  it('uses the home config path and refuses a path that lands in the repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-home-'))
    temps.push(dir)
    const homeKey = join(dir, '.config', 'sitebuilder', 'official-signing.key')
    const made = runScript('plugin-keygen.ts', [], childEnv({ HOME: dir, SITEBUILDER_PLUGIN_SIGNING_KEY: undefined }))
    expect(made.status, made.stderr).toBe(0)
    assertPublicLines(made.stdout)
    expect(existsSync(homeKey)).toBe(true)
    const inside = join(repo, 'official-signing.key')
    const refused = runScript('plugin-keygen.ts', [], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: inside }))
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('outside this repository')
    expect(existsSync(inside)).toBe(false)
    const linkDir = mkdtempSync(join(tmpdir(), 'sb-link-'))
    temps.push(linkDir)
    const link = join(linkDir, 'key.pem')
    symlinkSync(inside, link)
    const linked = runScript('plugin-keygen.ts', [], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: link }))
    expect(linked.status).toBe(2)
    expect(linked.stderr).toContain('outside this repository')
    expect(existsSync(inside)).toBe(false)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
  })
})

describe('pack and sign scripts', () => {
  it('packs and signs the official sources with a throwaway key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-pack-'))
    temps.push(dir)
    const keyFile = join(dir, 'official-signing.key')
    const made = runScript('plugin-keygen.ts', [], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    expect(made.status, made.stderr).toBe(0)
    const archive = join(dir, 'match.tar.gz')
    const packed = runScript('plugin-pack.ts', [join(official, 'match-thermometer'), '--out', archive], childEnv())
    expect(packed.status, packed.stderr).toBe(0)
    expect(packed.stdout).toMatch(/contentHash: [0-9a-f]{64}\narchive: /)
    expect(packed.stdout.includes('PRIVATE')).toBe(false)
    const signed = runScript('plugin-sign.ts', [archive, '--out', `${archive}.sig`], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    expect(signed.status, signed.stderr).toBe(0)
    expect(signed.stdout).toContain('id: match-thermometer')
    expect(signed.stdout).toContain('version: 1.0.0')
    expect(signed.stdout).toContain(`keyId: ${made.stdout.match(/keyId: ([0-9a-f]{16})/)?.[1]}`)
    expect(signed.stdout.includes('BEGIN')).toBe(false)
    expect(statSync(`${archive}.sig`).mode & 0o777).toBe(0o644)
    const out = join(dir, 'repo')
    const built = runScript('plugin-repo-build.ts', ['--source', official, '--out', out], childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: keyFile }))
    expect(built.status, built.stderr).toBe(0)
    expect(existsSync(join(out, 'index.json'))).toBe(true)
    expect(existsSync(join(out, 'index.json.sig'))).toBe(true)
    expect(existsSync(join(out, 'index.html'))).toBe(true)
    expect(existsSync(join(out, 'packages', 'gift-tiers', '1.0.0', 'gift-tiers-1.0.0.tar.gz'))).toBe(true)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).toContain('system-ui')
    expect(html).not.toContain('<script')
    const index = readFileSync(join(out, 'index.json'))
    const parsed = parseCanonicalIndex(index)
    expect(parsed.ok).toBe(true)
  })
})

describe('the test official key seam', () => {
  function signedArchive() {
    const key = keypair()
    const packed = packSource(join(official, 'match-thermometer'))
    const signature = signPluginSignature({
      privateKey: key.privateKey,
      publicKey: key.raw,
      contentHash: packed.hash.raw,
      pluginId: packed.manifest.id,
      version: packed.manifest.version,
    })
    return { key, archive: packed.archive, signature: Buffer.from(signature) }
  }

  it('treats a throwaway signature as self until the test flag is on', async () => {
    const { key, archive, signature } = signedArchive()
    process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS = JSON.stringify([key.listed])
    delete process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS
    const off = setup()
    const self = await installPluginArchive(off.ctx, off.admin, archive, signature)
    expect(self.trust).toBe('self')

    process.env.SITEBUILDER_PLUGIN_ALLOW_TEST_KEYS = '1'
    const on = setup()
    const officialInstall = await installPluginArchive(on.ctx, on.admin, archive, signature)
    expect(officialInstall.trust).toBe('official')

    process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS = JSON.stringify([{ id: 'ab'.repeat(8), publicKey: key.listed.publicKey }])
    const bad = setup()
    const stillSelf = await installPluginArchive(bad.ctx, bad.admin, archive, signature)
    expect(stillSelf.trust).toBe('self')

    const many = Array.from({ length: 4 }, () => keypair().listed)
    process.env.SITEBUILDER_PLUGIN_EXTRA_OFFICIAL_KEYS = JSON.stringify(many)
    const crowded = setup()
    const ignored = await installPluginArchive(crowded.ctx, crowded.admin, archive, signature)
    expect(ignored.trust).toBe('self')
    expect(createHash('sha256').update(key.listed.publicKey).digest('hex').length).toBe(64)
  })
})

describe('keygen does not touch the real signing key path', () => {
  it('keeps the spawn environment on a temp path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-env-'))
    temps.push(dir)
    const env = childEnv({ SITEBUILDER_PLUGIN_SIGNING_KEY: join(dir, 'official-signing.key') })
    expect(env.SITEBUILDER_PLUGIN_SIGNING_KEY?.includes('skewstone-keys')).toBe(false)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'marker'), 'ok')
  })
})
