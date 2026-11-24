// Public demo sandboxes, locks, and the Riverside golden snapshot.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { openDb } from '../server/db/client'
import { loadMigrationsFromDir } from '../server/db/migrations-fs'
import { pages } from '../server/db/schema'
import { testAiConnection } from '../server/services/ai-loop'
import { createUser, setSecret } from '../server/services/auth'
import { purgeTags, setPurgeHttp } from '../server/services/cloudflare'
import { buildDemoGolden } from '../server/services/demo-golden'
import { demoMutationRefusal } from '../server/services/demo-locks'
import {
  DEMO_IDLE_MS,
  applyEvictRequest,
  closeDemoSandboxes,
  computeChecksum,
  cookieDomain,
  demoLoginFailed,
  demoLoginLocked,
  demoLoginSucceeded,
  heartbeatFresh,
  openOrMint,
  openSandboxes,
  reopenSandboxes,
  resetDemoSandbox,
  runDemoSweep,
  runInSandbox,
  touchSandbox,
  verifyGoldenChecksum,
  writeGoldenChecksum,
  writeHeartbeat,
  type Sandbox,
} from '../server/services/demo-sandbox'
import { createEmailHandler, resolveMailer, sendTestEmail } from '../server/services/email'
import { AppError } from '../server/services/errors'
import type { Job } from '../server/services/jobs'
import { uploadMedia } from '../server/services/media'
import { createPage } from '../server/services/pages'
import { STARTER_TEMPLATES } from '../server/services/seed-data'
import { updateSettings } from '../server/services/settings'
import { createSite } from '../server/services/site'
import { createTemplate } from '../server/services/templates'
import { agentGatewayEnabled } from '../server/utils/agent'
import { dbPath, getDbHandle, mediaDir } from '../server/utils/state'
import { setup } from './helpers'

const roots: string[] = []

function scratch(): string {
  const dir = join(tmpdir(), `sb-demo-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  roots.push(dir)
  return dir
}

function rmTree(dir: string) {
  if (!existsSync(dir)) return
  spawnSync('chmod', ['-R', 'u+w', dir])
  rmSync(dir, { recursive: true, force: true })
}

function useRoot(root: string) {
  vi.stubEnv('SITEBUILDER_DEMO_ROOT', root)
}

/** A file-backed golden with one page. The full charity snapshot is a separate test. */
function writeTinyGolden(root: string): string {
  const golden = join(root, 'golden')
  mkdirSync(join(golden, 'media'), { recursive: true })
  mkdirSync(join(golden, 'site', 'releases', 'rel1'), { recursive: true })
  writeFileSync(join(golden, 'site', 'releases', 'rel1', 'index.html'), '<title>Tiny</title>\n')
  symlinkSync(join('releases', 'rel1'), join(golden, 'site', 'current'))
  const { db, sqlite } = openDb(join(golden, 'sitebuilder.db'), loadMigrationsFromDir())
  const registry = createDefaultRegistry()
  const now = () => new Date('2026-11-24T00:00:00Z')
  const siteId = createSite({ db, registry, now }, { name: 'Tiny pantry' })
  const ctx = { db, siteId, registry, now }
  const { user } = createUser(ctx, { email: 'tiny@example.org', name: 'Tiny', role: 'admin', password: 'a-long-test-password' })
  for (const [key, rules] of Object.entries(STARTER_TEMPLATES)) createTemplate(ctx, key, rules, user.id)
  const actor = { id: user.id, role: user.role as 'admin', isOperator: false }
  createPage(ctx, actor, { title: 'Fresh food for Riverside', template: 'standard', slug: 'home' })
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.close()
  rmSync(join(golden, 'sitebuilder.db-wal'), { force: true })
  rmSync(join(golden, 'sitebuilder.db-shm'), { force: true })
  writeGoldenChecksum(golden)
  return golden
}

function titleOf(sandbox: Sandbox): string {
  return sandbox.handle.db.select({ title: pages.title }).from(pages).where(eq(pages.slug, 'home')).get()!.title
}

function age(sandbox: Sandbox, iso: string) {
  sandbox.meta.lastSeen = iso
  writeFileSync(join(sandbox.root, 'meta.json'), JSON.stringify(sandbox.meta))
}

afterEach(() => {
  closeDemoSandboxes()
  setPurgeHttp(null)
  vi.unstubAllEnvs()
  for (const dir of roots.splice(0)) rmTree(dir)
})

describe('demo sandboxes', () => {
  it('keeps two visitors apart and restores only the one that resets', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    const a = openOrMint(null)
    const b = openOrMint(null)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.sandbox.id).not.toBe(b.sandbox.id)
    runInSandbox(a.sandbox, () => {
      a.sandbox.handle.db.update(pages).set({ title: 'Visitor A' }).where(eq(pages.slug, 'home')).run()
    })
    expect(titleOf(a.sandbox)).toBe('Visitor A')
    expect(titleOf(b.sandbox)).toBe('Fresh food for Riverside')
    const createdAt = a.sandbox.meta.createdAt
    const old = a.sandbox.handle.sqlite
    const reset = resetDemoSandbox(a.sandbox.id, { clientIp: '203.0.113.8', sessionSha256: 'abc' }, Date.parse('2026-11-24T03:00:00Z'))
    expect(old.open).toBe(false)
    expect(titleOf(reset)).toBe('Fresh food for Riverside')
    expect(titleOf(b.sandbox)).toBe('Fresh food for Riverside')
    expect(reset.meta.createdAt).toBe(createdAt)
    expect(reset.meta.lastReset).toBe('2026-11-24T03:00:00.000Z')
    const audit = readFileSync(join(root, 'audit.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { action: string; sandbox: string; clientIp: string; session: string })
    expect(audit).toEqual([{ time: '2026-11-24T03:00:00.000Z', clientIp: '203.0.113.8', session: 'abc', sandbox: a.sandbox.id, action: 'demo.reset' }])
    expect(readlinkSync(join(reset.sitePath, 'current'))).toBe(join('releases', 'rel1'))
  })

  it('updates lastSeen at most once a minute', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    const t = Date.parse('2026-11-24T12:00:00Z')
    const minted = openOrMint(null, t)
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    touchSandbox(minted.sandbox, t + 1000)
    expect(minted.sandbox.meta.lastSeen).toBe(new Date(t).toISOString())
    touchSandbox(minted.sandbox, t + 61_000)
    expect(minted.sandbox.meta.lastSeen).toBe(new Date(t + 61_000).toISOString())
    expect(minted.sandbox.meta.expiresAt).toBe(new Date(t + 61_000 + DEMO_IDLE_MS).toISOString())
  })

  it('refuses to delete sandboxes when the golden checksum does not match', () => {
    const root = scratch()
    useRoot(root)
    const golden = writeTinyGolden(root)
    const minted = openOrMint(null)
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    writeFileSync(join(golden, 'checksum.txt'), 'nope\n')
    expect(() => runDemoSweep()).toThrow(/Golden checksum mismatch/)
    expect(existsSync(minted.sandbox.root)).toBe(true)
    expect(existsSync(join(golden, 'sitebuilder.db'))).toBe(true)
  })

  it('hashes a symlink as its target text', () => {
    const root = scratch()
    const golden = writeTinyGolden(root)
    const linkHash = createHash('sha256').update('releases/rel1').digest('hex')
    expect(computeChecksum(golden)).toContain(`${linkHash}  site/current\n`)
    expect(readlinkSync(join(golden, 'site', 'current'))).toBe(join('releases', 'rel1'))
  })

  it('deletes an idle sandbox itself when the server heartbeat is stale', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    const minted = openOrMint(null, Date.parse('2026-11-24T00:00:00Z'))
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    age(minted.sandbox, '2026-11-24T00:00:00.000Z')
    const now = Date.parse('2026-11-24T03:00:00Z')
    expect(heartbeatFresh(30_000, now)).toBe(false)
    const swept = runDemoSweep({ now })
    expect(swept.deleted).toEqual([minted.sandbox.id])
    expect(existsSync(minted.sandbox.root)).toBe(false)
  })

  it('asks the live server to close an idle sandbox before deleting it', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    const now = Date.parse('2026-11-24T06:00:00Z')
    writeHeartbeat(now)
    const minted = openOrMint(null, now - 3 * 60 * 60 * 1000)
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    age(minted.sandbox, new Date(now - 3 * 60 * 60 * 1000).toISOString())
    const swept = runDemoSweep({
      now,
      waitMs: 2_000,
      onWait() {
        applyEvictRequest()
      },
    })
    expect(swept.deleted).toEqual([minted.sandbox.id])
    expect(existsSync(join(root, 'evict.request'))).toBe(false)
    expect(existsSync(minted.sandbox.root)).toBe(false)
  })

  it('returns full when every sandbox was seen in the last 10 minutes', () => {
    const root = scratch()
    useRoot(root)
    vi.stubEnv('SITEBUILDER_DEMO_MAX_SANDBOXES', '2')
    writeTinyGolden(root)
    const now = Date.parse('2026-11-24T08:00:00Z')
    const first = openOrMint(null, now)
    const second = openOrMint(null, now)
    const third = openOrMint(null, now)
    expect(first.ok && second.ok).toBe(true)
    expect(third).toEqual({ ok: false, full: true })
    if (!first.ok || !second.ok) return
    expect(existsSync(first.sandbox.root)).toBe(true)
    expect(existsSync(second.sandbox.root)).toBe(true)
    age(first.sandbox, new Date(now - 11 * 60 * 1000).toISOString())
    const fourth = openOrMint(null, now)
    expect(fourth.ok).toBe(true)
    expect(existsSync(first.sandbox.root)).toBe(false)
    expect(existsSync(second.sandbox.root)).toBe(true)
  })

  it('reopens sandboxes that have not expired', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    const minted = openOrMint(null)
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    const id = minted.sandbox.id
    closeDemoSandboxes()
    reopenSandboxes()
    reopenSandboxes()
    expect(openSandboxes().map((sandbox) => sandbox.id)).toEqual([id])
  })

  it('reads paths from the sandbox even when demo mode is off', () => {
    const root = scratch()
    useRoot(root)
    writeTinyGolden(root)
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '1')
    expect(() => dbPath()).toThrow(/no process-wide database/)
    expect(() => getDbHandle()).toThrow(AppError)
    const minted = openOrMint(null)
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '')
    runInSandbox(minted.sandbox, () => {
      expect(getDbHandle()).toBe(minted.sandbox.handle)
      expect(dbPath()).toBe(minted.sandbox.dbPath)
      expect(mediaDir()).toBe(minted.sandbox.mediaPath)
    })
  })

  it('sets the cookie domain only for skewstone.com hosts', () => {
    expect(cookieDomain('demo-admin.skewstone.com')).toBe('.skewstone.com')
    expect(cookieDomain('skewstone.com:443')).toBe('.skewstone.com')
    expect(cookieDomain('127.0.0.1:3020')).toBeUndefined()
    expect(cookieDomain('preview.example')).toBeUndefined()
    expect(cookieDomain(undefined)).toBeUndefined()
  })
})

describe('demo locks', () => {
  it('turns the agent gateway off while demo mode is on', () => {
    vi.stubEnv('SITEBUILDER_AGENT_GATEWAY', '1')
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '1')
    expect(agentGatewayEnabled()).toBe(false)
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '')
    expect(agentGatewayEnabled()).toBe(true)
  })

  it('does not write mail or call Cloudflare without the demo token', async () => {
    const s = setup()
    const outbox = join(scratch(), 'outbox')
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '1')
    vi.stubEnv('SITEBUILDER_MAIL_OUTBOX', outbox)
    vi.stubEnv('SITEBUILDER_CLOUDFLARE_ZONE_ID', 'zone')
    vi.stubEnv('SITEBUILDER_CLOUDFLARE_TOKEN', 'stored-token')
    const mailer = resolveMailer(s.ctx)
    expect(mailer).not.toBeNull()
    mailer!.send({ to: 'a@example.org', subject: 'Hi', text: 'No' })
    expect(existsSync(outbox)).toBe(false)
    const skipped = await createEmailHandler({ baseUrl: 'http://example.test', mailer }).run(s.ctx, { payload: {} } as Job)
    expect(skipped).toEqual({ skipped: 'Demo mode does not send mail.' })
    await expect(sendTestEmail(s.ctx, s.admin, 'a@example.org')).rejects.toMatchObject({ code: 'forbidden' })
    let called = false
    setPurgeHttp(async () => {
      called = true
      return new Response('{}', { status: 200 })
    })
    expect(await purgeTags(s.ctx, ['docs'])).toEqual({ skipped: 'Demo mode does not purge Cloudflare.' })
    expect(called).toBe(false)
    vi.stubEnv('SITEBUILDER_DEMO_CF_ZONE_ID', 'demo-zone')
    vi.stubEnv('SITEBUILDER_DEMO_CF_TOKEN', 'demo-token')
    expect(await purgeTags(s.ctx, ['docs'])).toEqual({ purged: ['docs'] })
    expect(called).toBe(true)
    s.sqlite.close()
  })

  it('refuses hostname, indexing, mail, AI, secrets, and uploads over the quota', async () => {
    const s = setup()
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '1')
    vi.stubEnv('SITEBUILDER_DEMO_UPLOAD_QUOTA_BYTES', '1')
    expect(updateSettings(s.ctx, s.admin, { name: 'Still a charity' }).name).toBe('Still a charity')
    expect(() => updateSettings(s.ctx, s.admin, { primaryDomain: 'evil.example' })).toThrow(/hostname/)
    expect(() => updateSettings(s.ctx, s.admin, { seo: { allowIndexing: true } })).toThrow(/indexing/)
    expect(() => updateSettings(s.ctx, s.admin, { seo: { robotsTxt: 'User-agent: *\nDisallow:\n' } })).toThrow(/indexing/)
    expect(() => updateSettings(s.ctx, s.admin, { mail: { from: 'desk@example.org' } })).toThrow(/mail/)
    expect(() => updateSettings(s.ctx, s.admin, { ai: { enabled: false } })).toThrow(/AI/)
    expect(() => setSecret(s.ctx, Buffer.alloc(32), 'ai_api_key', 'not-a-real-key', s.admin.id)).toThrow(/secrets/)
    await expect(testAiConnection(s.ctx, { provider: { name: 'mock' } as never })).rejects.toMatchObject({ code: 'forbidden' })
    const mediaRoot = join(scratch(), 'media')
    mkdirSync(mediaRoot)
    await expect(uploadMedia(s.ctx, s.admin, { filename: 'a.png', data: Buffer.from('xx'), mediaDir: mediaRoot })).rejects.toMatchObject({ code: 'forbidden', message: 'This demo has reached its upload limit.' })
    s.sqlite.close()
  })

  it('locks sign-in after the configured number of failures', () => {
    vi.stubEnv('SITEBUILDER_DEMO_LOGIN_MAX_FAILS', '3')
    const ip = '203.0.113.9'
    const now = Date.parse('2026-11-24T10:00:00Z')
    demoLoginFailed(ip, now)
    demoLoginFailed(ip, now)
    expect(demoLoginLocked(ip, now)).toBe(false)
    demoLoginFailed(ip, now)
    expect(demoLoginLocked(ip, now)).toBe(true)
    expect(demoLoginLocked(ip, now + 15 * 60_000)).toBe(false)
    demoLoginFailed(ip, now)
    demoLoginSucceeded(ip)
    expect(demoLoginLocked(ip, now)).toBe(false)
  })

  it('refuses every plugin mutation and the other locked paths', () => {
    const refused: [string, string][] = [
      ['POST', '/api/v1/plugins'],
      ['PUT', '/api/v1/plugins'],
      ['PATCH', '/api/v1/plugins/pkg'],
      ['DELETE', '/api/v1/plugins/pkg'],
      ['POST', '/api/v1/plugins/repository/install'],
      ['POST', '/api/v1/plugins/repository/install?force=1'],
      ['POST', '/api/v1/ai'],
      ['POST', '/api/v1/ai/complete'],
      ['PATCH', '/api/v1/settings/ai'],
      ['PUT', '/api/v1/settings/mail'],
      ['POST', '/api/v1/agent/tokens'],
      ['DELETE', '/api/v1/agent/webhook'],
      ['POST', '/api/v1/users'],
      ['PATCH', '/api/v1/users/usr_1'],
      ['DELETE', '/api/v1/users/usr_1'],
      ['POST', '/api/v1/backups'],
      ['DELETE', '/api/v1/backups/bk_1'],
      ['PUT', '/api/v1/settings/secrets/ai_api_key'],
      ['POST', '/api/v1/media/med_1/suggest-alt'],
    ]
    for (const [method, path] of refused) expect(demoMutationRefusal(method, path), `${method} ${path}`).toEqual(expect.any(String))
    expect(demoMutationRefusal('GET', '/api/v1/plugins')).toBeNull()
    expect(demoMutationRefusal('GET', '/api/v1/plugins/repository')).toBeNull()
    expect(demoMutationRefusal('HEAD', '/api/v1/users')).toBeNull()
    expect(demoMutationRefusal('GET', '/api/v1/backups')).toBeNull()
    expect(demoMutationRefusal('POST', '/api/v1/pages')).toBeNull()
    expect(demoMutationRefusal('PATCH', '/api/v1/settings')).toBeNull()
  })
})

describe('riverside golden', () => {
  it('builds the fictional pantry snapshot', async () => {
    const root = scratch()
    useRoot(root)
    const golden = await buildDemoGolden(root, { readOnly: true })
    verifyGoldenChecksum()
    expect(readlinkSync(join(golden, 'site', 'current')).startsWith('releases/')).toBe(true)
    const dbStat = spawnSync('stat', ['-c', '%a', join(golden, 'sitebuilder.db')], { encoding: 'utf8' })
    expect(dbStat.stdout.trim()).toBe('444')
    spawnSync('chmod', ['-R', 'u+w', golden])
    const { db, sqlite } = openDb(join(golden, 'sitebuilder.db'), loadMigrationsFromDir())
    const home = db.select({ title: pages.title, slug: pages.slug }).from(pages).where(eq(pages.slug, '')).get()
    expect(home).toMatchObject({ title: 'Fresh food for Riverside', slug: '' })
    sqlite.close()
    const release = readlinkSync(join(golden, 'site', 'current'))
    const html = readFileSync(join(golden, 'site', release, 'index.html'), 'utf8')
    expect(html).toContain('Fresh food for Riverside')
    expect(html).toContain('18 Harbour Lane')
    expect(html.toLowerCase()).not.toContain('hope for street')
    expect(html).toContain('noindex')
  }, 120_000)
})
