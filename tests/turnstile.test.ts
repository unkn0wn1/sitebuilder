import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertDemoTurnstileConfigured, turnstileVerifyEndpoint, verifyTurnstileToken } from '../server/services/turnstile'

const PASS_SECRET = '1x0000000000000000000000000000000AA'
const FAIL_SECRET = '2x0000000000000000000000000000000AA'
const REAL_SECRET = 'real-secret-not-a-test-key'
const DUMMY = 'XXXX.DUMMY.TOKEN.XXXX'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('turnstile verify', () => {
  it('rejects a missing token without calling fetch', async () => {
    const fetchImpl = vi.fn()
    const verdict = await verifyTurnstileToken({ token: '  ', secret: PASS_SECRET, remoteip: '203.0.113.9', host: 'demo-admin.skewstone.com', fetchImpl })
    expect(verdict).toEqual({ ok: false, status: 403, body: { error: { code: 'turnstile_failed', message: 'Complete the check, then sign in.' } } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts a passing verify and sends the client address', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body))
      expect(form.get('secret')).toBe(PASS_SECRET)
      expect(form.get('response')).toBe(DUMMY)
      expect(form.get('remoteip')).toBe('203.0.113.9')
      expect(form.get('idempotency_key')).toMatch(/^[0-9a-f-]{36}$/)
      return jsonResponse({ success: true, hostname: 'example.com' })
    })
    const verdict = await verifyTurnstileToken({ token: DUMMY, secret: PASS_SECRET, remoteip: '203.0.113.9', host: 'demo-admin.skewstone.com', fetchImpl })
    expect(verdict).toEqual({ ok: true })
  })

  it('rejects a failing verify', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, hostname: 'example.com', 'error-codes': ['invalid-input-response'] }))
    const verdict = await verifyTurnstileToken({ token: DUMMY, secret: FAIL_SECRET, remoteip: null, host: 'demo-admin.skewstone.com', fetchImpl })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('skips the hostname check for a documented test secret', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, hostname: 'example.com' }))
    const verdict = await verifyTurnstileToken({ token: DUMMY, secret: PASS_SECRET, remoteip: null, host: 'demo-admin.skewstone.com', fetchImpl })
    expect(verdict).toEqual({ ok: true })
  })

  it('rejects a hostname that does not match the request host', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, hostname: 'example.com' }))
    const verdict = await verifyTurnstileToken({ token: DUMMY, secret: REAL_SECRET, remoteip: null, host: 'demo-admin.skewstone.com:443', fetchImpl })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('accepts a matching hostname for a real secret', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, hostname: 'Demo-Admin.Skewstone.com' }))
    const verdict = await verifyTurnstileToken({ token: DUMMY, secret: REAL_SECRET, remoteip: null, host: 'demo-admin.skewstone.com', fetchImpl })
    expect(verdict).toEqual({ ok: true })
  })

  it('fails closed when fetch throws or the body is not JSON', async () => {
    const thrown = await verifyTurnstileToken({
      token: DUMMY,
      secret: PASS_SECRET,
      remoteip: null,
      host: 'localhost',
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    expect(thrown).toMatchObject({ ok: false, status: 503 })
    const bad = await verifyTurnstileToken({
      token: DUMMY,
      secret: PASS_SECRET,
      remoteip: null,
      host: 'localhost',
      fetchImpl: async () => new Response('nope', { status: 502 }),
    })
    expect(bad).toMatchObject({ ok: false, status: 503 })
  })
})

describe('turnstile config', () => {
  it('refuses to start demo mode without a secret unless the check is disabled', () => {
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '1')
    vi.stubEnv('SITEBUILDER_TURNSTILE_SECRET_KEY', '')
    vi.stubEnv('SITEBUILDER_TURNSTILE_DISABLED', '')
    expect(() => assertDemoTurnstileConfigured()).toThrow(/SITEBUILDER_TURNSTILE_SECRET_KEY/)
    vi.stubEnv('SITEBUILDER_TURNSTILE_DISABLED', '1')
    expect(() => assertDemoTurnstileConfigured()).not.toThrow()
    vi.stubEnv('SITEBUILDER_DEMO_MODE', '')
    vi.stubEnv('SITEBUILDER_TURNSTILE_DISABLED', '')
    vi.stubEnv('SITEBUILDER_TURNSTILE_SECRET_KEY', '')
    expect(() => assertDemoTurnstileConfigured()).not.toThrow()
  })

  it('uses Cloudflare in production unless a loopback stub is explicitly allowed', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SITEBUILDER_TURNSTILE_VERIFY_URL', '')
    vi.stubEnv('SITEBUILDER_TURNSTILE_ALLOW_STUB', '')
    expect(turnstileVerifyEndpoint()).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    vi.stubEnv('SITEBUILDER_TURNSTILE_VERIFY_URL', 'https://evil.example/siteverify')
    expect(turnstileVerifyEndpoint()).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    vi.stubEnv('SITEBUILDER_TURNSTILE_ALLOW_STUB', '1')
    expect(turnstileVerifyEndpoint()).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    vi.stubEnv('SITEBUILDER_TURNSTILE_VERIFY_URL', 'http://127.0.0.1:9/siteverify')
    expect(turnstileVerifyEndpoint()).toBe('http://127.0.0.1:9/siteverify')
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SITEBUILDER_TURNSTILE_ALLOW_STUB', '')
    vi.stubEnv('SITEBUILDER_TURNSTILE_VERIFY_URL', 'http://127.0.0.1:9/siteverify')
    expect(turnstileVerifyEndpoint()).toBe('http://127.0.0.1:9/siteverify')
  })
})
