// HTTP checks for the public demo. The shared API server stays in normal mode.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../shared/demo'
import { buildDemoGolden } from '../../server/services/demo-golden'
import { startServer, type TestServer } from './server'

const normalUrl = inject('baseUrl')

class Jar {
  readonly cookies = new Map<string, string>()
  constructor(private baseUrl: string) {}

  private absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? ''
      const cut = pair.indexOf('=')
      if (cut < 0) continue
      const name = pair.slice(0, cut)
      const value = pair.slice(cut + 1)
      if (!value) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async req(method: string, path: string, body?: unknown, extra: { origin?: string | null; forwardedFor?: string; proto?: string } = {}) {
    const headers: Record<string, string> = {}
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    if (cookie) headers.cookie = cookie
    if (extra.origin !== null) headers.origin = extra.origin ?? this.baseUrl
    if (extra.forwardedFor) headers['x-forwarded-for'] = extra.forwardedFor
    if (extra.proto) headers['x-forwarded-proto'] = extra.proto
    let payload: string | undefined
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload })
    this.absorb(res)
    const type = res.headers.get('content-type') ?? ''
    const parsed = type.includes('json') ? await res.json() : await res.text()
    return { status: res.status, body: parsed as any, headers: res.headers, text: typeof parsed === 'string' ? parsed : '' }
  }
}

function copyGolden(from: string, to: string) {
  mkdirSync(to, { recursive: true })
  cpSync(join(from, 'golden'), join(to, 'golden'), { recursive: true })
}

function rmTree(dir: string) {
  spawnSync('chmod', ['-R', 'u+w', dir])
  rmSync(dir, { recursive: true, force: true })
}

describe('demo mode over HTTP', () => {
  const roots: string[] = []
  let demo: TestServer
  let capped: TestServer
  let bare: TestServer
  let secure: TestServer

  beforeAll(async () => {
    const goldenRoot = join(tmpdir(), `sb-demo-http-${process.pid}`)
    rmTree(goldenRoot)
    roots.push(goldenRoot)
    await buildDemoGolden(goldenRoot, { readOnly: true })
    const env = {
      SITEBUILDER_DEMO_MODE: '1',
      SITEBUILDER_AGENT_GATEWAY: '1',
      SITEBUILDER_DEMO_LOGIN_MAX_FAILS: '3',
      SITEBUILDER_DOCS_URL: 'https://docs.skewstone.com',
    }
    demo = await startServer({ ...env, SITEBUILDER_DEMO_ROOT: goldenRoot, SITEBUILDER_DEMO_MAX_SANDBOXES: '40' }, { seed: false })
    const capRoot = join(tmpdir(), `sb-demo-cap-${process.pid}`)
    rmTree(capRoot)
    roots.push(capRoot)
    copyGolden(goldenRoot, capRoot)
    capped = await startServer({ ...env, SITEBUILDER_DEMO_ROOT: capRoot, SITEBUILDER_DEMO_MAX_SANDBOXES: '1' }, { seed: false })
    const bareRoot = join(tmpdir(), `sb-demo-bare-${process.pid}`)
    rmTree(bareRoot)
    mkdirSync(bareRoot, { recursive: true })
    roots.push(bareRoot)
    bare = await startServer({ ...env, SITEBUILDER_DEMO_ROOT: bareRoot }, { seed: false })
    const secureRoot = join(tmpdir(), `sb-demo-secure-${process.pid}`)
    rmTree(secureRoot)
    roots.push(secureRoot)
    copyGolden(goldenRoot, secureRoot)
    secure = await startServer({ ...env, SITEBUILDER_DEMO_ROOT: secureRoot, SITEBUILDER_INSECURE_COOKIES: '0' }, { seed: false })
  }, 180_000)

  afterAll(async () => {
    await Promise.all([demo, capped, bare, secure].filter(Boolean).map((server) => server.stop()))
    for (const dir of roots) rmTree(dir)
  })

  it('does not index the demo, and health does not mint a sandbox', async () => {
    const health = await fetch(`${demo.baseUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(health.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(health.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(false)
    const v1 = await fetch(`${demo.baseUrl}/api/v1/health`)
    expect(v1.status).toBe(200)
    expect(v1.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(v1.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(false)
    const favicon = await fetch(`${demo.baseUrl}/favicon.ico`)
    const asset = await fetch(`${demo.baseUrl}/_nuxt/missing.js`)
    expect(favicon.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(false)
    expect(asset.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(false)
    const robots = await fetch(`${demo.baseUrl}/robots.txt`)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
    expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(robots.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(false)
    const page = await fetch(`${demo.baseUrl}/`)
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await page.text()).toContain('<meta name="robots" content="noindex, nofollow">')
    const gateway = await fetch(`${demo.baseUrl}/agent/v1/site`)
    expect(gateway.status).toBe(404)
  })

  it('gives each visitor a sandbox, isolates edits, and resets only that visitor', async () => {
    const a = new Jar(demo.baseUrl)
    const b = new Jar(demo.baseUrl)
    const statusA = await a.req('GET', '/api/v1/demo/status', undefined, { origin: null })
    expect(statusA.body).toMatchObject({ demo: true, lastReset: null, docsUrl: 'https://docs.skewstone.com' })
    expect(statusA.headers.get('cache-control')).toContain('no-store')
    const cookieA = statusA.headers.getSetCookie().find((line) => line.startsWith('sb_demo=')) ?? ''
    expect(cookieA.toLowerCase()).toContain('httponly')
    expect(cookieA.toLowerCase()).toContain('samesite=lax')
    expect(cookieA.toLowerCase()).toContain('path=/')
    expect(cookieA.toLowerCase()).toContain('max-age=7200')
    expect(cookieA.toLowerCase()).not.toContain('secure')
    expect(cookieA.toLowerCase()).not.toContain('domain=')
    await b.req('GET', '/api/v1/demo/status', undefined, { origin: null })
    expect(a.cookies.get('sb_demo')).toMatch(/^[a-f0-9]{32}$/)
    expect(b.cookies.get('sb_demo')).toMatch(/^[a-f0-9]{32}$/)
    expect(a.cookies.get('sb_demo')).not.toBe(b.cookies.get('sb_demo'))

    const ipA = '203.0.113.21'
    const ipB = '203.0.113.22'
    expect((await a.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { forwardedFor: ipA })).status).toBe(200)
    expect((await b.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { forwardedFor: ipB })).status).toBe(200)

    const retitle = async (jar: Jar, title: string, ip: string) => {
      const list = await jar.req('GET', '/api/v1/pages', undefined, { origin: null, forwardedFor: ip })
      const home = list.body.items.find((item: { path: string }) => item.path === '/')
      const page = await jar.req('GET', `/api/v1/pages/${home.id}`, undefined, { origin: null, forwardedFor: ip })
      const edited = await jar.req('POST', `/api/v1/pages/${home.id}/ops`, { baseRevision: page.body.revision, ops: [{ op: 'set_meta', title }] }, { forwardedFor: ip })
      expect(edited.status, edited.text || JSON.stringify(edited.body)).toBe(200)
    }
    await retitle(a, 'Visitor A pantry', ipA)
    await retitle(b, 'Visitor B pantry', ipB)
    const titles = async (jar: Jar, ip: string) => {
      const list = await jar.req('GET', '/api/v1/pages', undefined, { origin: null, forwardedFor: ip })
      return list.body.items.map((item: { title: string }) => item.title) as string[]
    }
    expect(await titles(a, ipA)).toContain('Visitor A pantry')
    expect(await titles(a, ipA)).not.toContain('Visitor B pantry')
    expect(await titles(b, ipB)).toContain('Visitor B pantry')
    expect(await titles(b, ipB)).not.toContain('Visitor A pantry')

    const reset = await a.req('POST', '/api/v1/demo/reset', {}, { forwardedFor: ipA })
    expect(reset.status).toBe(200)
    expect(reset.body.ok).toBe(true)
    expect(typeof reset.body.lastReset).toBe('string')
    expect((await a.req('GET', '/api/v1/auth/me', undefined, { origin: null, forwardedFor: ipA })).status).toBe(200)
    expect(await titles(a, ipA)).toContain('Fresh food for Riverside')
    expect(await titles(a, ipA)).not.toContain('Visitor A pantry')
    expect(await titles(b, ipB)).toContain('Visitor B pantry')
    const statusAfter = await a.req('GET', '/api/v1/demo/status', undefined, { origin: null })
    expect(statusAfter.body.lastReset).toBe(reset.body.lastReset)
  })

  it('locks an address after repeated bad passwords, then still allows another address', async () => {
    const locked = new Jar(demo.baseUrl)
    const ip = '203.0.113.30'
    for (let i = 0; i < 3; i++) {
      const bad = await locked.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: 'not-the-demo-password' }, { forwardedFor: ip })
      expect(bad.status).toBe(401)
    }
    const blocked = await locked.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { forwardedFor: ip })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('900')
    expect(blocked.body.error.code).toBe('rate_limited')
    const other = new Jar(demo.baseUrl)
    const ok = await other.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { forwardedFor: '203.0.113.31' })
    expect(ok.status).toBe(200)
  })

  it('refuses plugin installs and other locked mutations before the CSRF check', async () => {
    const jar = new Jar(demo.baseUrl)
    await jar.req('GET', '/api/v1/demo/status', undefined, { origin: null })
    const paths = ['/api/v1/plugins', '/api/v1/plugins/repository/install', '/api/v1/ai/complete', '/api/v1/settings/ai', '/api/v1/settings/mail', '/api/v1/agent/tokens', '/api/v1/agent/webhook', '/api/v1/users', '/api/v1/backups', '/api/v1/settings/secrets/ai_api_key', '/api/v1/media/med_1/suggest-alt']
    for (const path of paths) {
      const refused = await jar.req('POST', path, {}, { origin: null })
      expect(refused.status, path).toBe(403)
      expect(refused.body.error.code).toBe('forbidden')
    }
    const install = await jar.req('DELETE', '/api/v1/plugins/pkg', undefined, { origin: null })
    expect(install.status).toBe(403)
    expect(install.body.error.message).toMatch(/Plugin installs/)
    const signed = new Jar(demo.baseUrl)
    await signed.req('POST', '/api/v1/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }, { forwardedFor: '203.0.113.40' })
    expect((await signed.req('PATCH', '/api/v1/settings', { primaryDomain: 'evil.example' })).status).toBe(403)
    expect((await signed.req('PATCH', '/api/v1/settings', { seo: { allowIndexing: true } })).status).toBe(403)
    expect((await signed.req('PATCH', '/api/v1/settings', { mail: { from: 'desk@example.org' } })).status).toBe(403)
    expect((await signed.req('PATCH', '/api/v1/settings', { ai: { enabled: false } })).status).toBe(403)
    const renamed = await signed.req('PATCH', '/api/v1/settings', { name: 'Riverside pantry desk' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.name).toBe('Riverside pantry desk')
  })

  it('says the demo is full without evicting a sandbox seen in the last 10 minutes', async () => {
    const first = await fetch(`${capped.baseUrl}/api/v1/demo/status`)
    expect(first.status).toBe(200)
    const second = await fetch(`${capped.baseUrl}/api/v1/demo/status`)
    expect(second.status).toBe(503)
    expect(second.headers.get('retry-after')).toBe('60')
    expect(second.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await second.text()).toContain('The demo is full. Try again shortly.')
    expect(first.headers.getSetCookie().some((line) => line.startsWith('sb_demo='))).toBe(true)
  })

  it('reports a missing golden snapshot', async () => {
    const res = await fetch(`${bare.baseUrl}/`)
    expect(res.status).toBe(503)
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await res.text()).toContain('Demo golden snapshot is missing. Run npm run demo:golden.')
  })

  it('marks the demo cookie Secure when the forwarded proto is https', async () => {
    const url = new URL(secure.baseUrl)
    const insecure = await fetch(`${secure.baseUrl}/api/v1/demo/status`)
    const plain = insecure.headers.getSetCookie().find((line) => line.startsWith('sb_demo=')) ?? ''
    expect(plain.toLowerCase()).not.toContain('secure')
    const secureCookie = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: '/api/v1/demo/status', method: 'GET', headers: { 'x-forwarded-proto': 'https', host: 'demo-admin.skewstone.com' } },
        (res) => {
          res.resume()
          const lines = res.headers['set-cookie'] ?? []
          resolve(lines.find((line) => line.startsWith('sb_demo=')) ?? '')
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(secureCookie.toLowerCase()).toContain('secure')
    expect(secureCookie.toLowerCase()).toContain('domain=.skewstone.com')
  })

  it('stays out of the way when demo mode is off', async () => {
    const health = await fetch(`${normalUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(health.headers.get('x-robots-tag')).toBeNull()
    const robots = await fetch(`${normalUrl}/robots.txt`)
    expect(await robots.text()).toBe('User-Agent: *\nDisallow:\n')
    const status = await fetch(`${normalUrl}/api/v1/demo/status`)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ demo: false, lastReset: null, docsUrl: null })
    const reset = await fetch(`${normalUrl}/api/v1/demo/reset`, {
      method: 'POST',
      headers: { origin: normalUrl, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(reset.status).toBe(404)
    expect((await reset.json()).error.code).toBe('not_found')
    const home = await fetch(`${normalUrl}/`)
    expect(home.headers.get('x-robots-tag')).toBeNull()
    expect(await home.text()).not.toContain('name="robots" content="noindex, nofollow"')
  })
})
