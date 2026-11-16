import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

// A second server with Cloudflare Access switched on. Valid tokens are covered by tests/access.test.ts;
// here we check that the server refuses requests without one, and still answers health checks.
let server: TestServer

beforeAll(async () => {
  server = await startServer({ SITEBUILDER_ALLOW_NO_ACCESS: '', SITEBUILDER_ACCESS_AUD: 'test-aud', SITEBUILDER_ACCESS_TEAM_DOMAIN: 'example-team' })
})
afterAll(async () => {
  await server?.stop()
})

describe('Cloudflare Access over HTTP', () => {
  it('blocks requests without a valid Access token', async () => {
    expect((await fetch(`${server.baseUrl}/api/health`)).status).toBe(200)
    const r = await fetch(`${server.baseUrl}/api/v1/pages`)
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: { code: 'forbidden', message: 'Sign in through Cloudflare Access first.' } })
    expect((await fetch(`${server.baseUrl}/api/v1/auth/me`, { headers: { 'cf-access-jwt-assertion': 'forged.token.here' } })).status).toBe(403)
    expect((await fetch(`${server.baseUrl}/`)).status).toBe(403)
  })

  it('refuses to start in production without Access settings', async () => {
    await expect(startServer({ SITEBUILDER_ALLOW_NO_ACCESS: '' }, { seed: false })).rejects.toThrow(/SITEBUILDER_ACCESS_TEAM_DOMAIN/)
  })
})
