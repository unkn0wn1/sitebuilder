// HTTP tests for Sign in with xAI against a mocked auth server. The shared API
// server keeps the feature flag off; this file starts its own builder.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from './client'
import { ADMIN_EMAIL, PASSWORD, startServer, type TestServer } from './server'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

async function startMockAuth(): Promise<{ origin: string; stop: () => Promise<void>; tokenPosts: string[] }> {
  const tokenPosts: string[] = []
  let tokenCalls = 0
  let origin = ''
  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? '/'
    if (req.method === 'GET' && url === '/.well-known/openid-configuration') {
      send(res, 200, {
        issuer: origin,
        device_authorization_endpoint: `${origin}/oauth2/device/code`,
        token_endpoint: `${origin}/oauth2/token`,
        revocation_endpoint: `${origin}/oauth2/revoke`,
        userinfo_endpoint: `${origin}/oauth2/userinfo`,
      })
      return
    }
    const body = req.method === 'POST' ? await readBody(req) : ''
    if (req.method === 'POST' && url === '/oauth2/device/code') {
      expect(body).toContain('client_id=test-client')
      send(res, 200, {
        device_code: 'device-secret-do-not-leak',
        user_code: 'WXYZ-1234',
        verification_uri: `${origin}/verify`,
        verification_uri_complete: `${origin}/verify?user_code=WXYZ-1234`,
        expires_in: 600,
        interval: 0,
      })
      return
    }
    if (req.method === 'POST' && url === '/oauth2/token') {
      tokenPosts.push(body)
      tokenCalls += 1
      if (body.includes('grant_type=refresh_token')) {
        send(res, 200, { access_token: 'access-live-2', refresh_token: 'refresh-live-2', expires_in: 3600 })
        return
      }
      if (tokenCalls === 1) {
        send(res, 400, { error: 'authorization_pending' })
        return
      }
      send(res, 200, { access_token: 'access-live-1', refresh_token: 'refresh-live-1', expires_in: 3600 })
      return
    }
    if (req.method === 'GET' && url === '/oauth2/userinfo') {
      send(res, 200, { email: 'admin@example.org' })
      return
    }
    if (req.method === 'POST' && url === '/oauth2/revoke') {
      send(res, 200, {})
      return
    }
    send(res, 404, { error: 'not_found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('mock auth did not bind a port')
  origin = `http://127.0.0.1:${addr.port}`
  return {
    origin,
    tokenPosts,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

describe('settings xAI OAuth (flag on, mocked auth server)', () => {
  let auth: Awaited<ReturnType<typeof startMockAuth>>
  let server: TestServer
  let admin: Client

  beforeAll(async () => {
    auth = await startMockAuth()
    server = await startServer({
      SITEBUILDER_ENABLE_XAI_OAUTH: '1',
      SITEBUILDER_XAI_OAUTH_DISCOVERY_URL: `${auth.origin}/.well-known/openid-configuration`,
      SITEBUILDER_XAI_OAUTH_CLIENT_ID: 'test-client',
    })
    admin = new Client(server.baseUrl)
    await admin.login(ADMIN_EMAIL, PASSWORD)
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await auth?.stop()
  })

  it('lets an admin start, poll, connect and disconnect, and never returns tokens', async () => {
    const settings = await admin.get('/settings')
    expect(settings.status).toBe(200)
    expect(settings.body.xaiOauth).toEqual({ enabled: true, connected: false, account: null })

    const start = await admin.post('/settings/ai/xai/start', {})
    expect(start.status).toBe(200)
    expect(start.body.userCode).toBe('WXYZ-1234')
    expect(start.body.verificationUri).toBe(`${auth.origin}/verify`)
    expect(start.body.pendingId).toMatch(/^[a-f0-9]{32}$/)
    const leaked = JSON.stringify(start.body)
    expect(leaked).not.toContain('device-secret-do-not-leak')
    expect(leaked).not.toContain('access-live')
    expect(leaked).not.toContain('refresh-live')

    const pending = await admin.post('/settings/ai/xai/poll', { pendingId: start.body.pendingId })
    expect(pending.status).toBe(200)
    expect(pending.body.status).toBe('pending')

    const connected = await admin.post('/settings/ai/xai/poll', { pendingId: start.body.pendingId })
    expect(connected.status).toBe(200)
    expect(connected.body).toEqual({ status: 'connected', account: 'admin@example.org' })
    expect(JSON.stringify(connected.body)).not.toContain('access-live-1')
    expect(JSON.stringify(connected.body)).not.toContain('refresh-live-1')

    const after = await admin.get('/settings')
    expect(after.body.xaiOauth).toEqual({ enabled: true, connected: true, account: 'admin@example.org' })
    expect(JSON.stringify(after.body)).not.toContain('access-live')
    expect(JSON.stringify(after.body)).not.toContain('refresh-live')
    expect(JSON.stringify(after.body)).not.toContain('device-secret')

    const disconnect = await admin.post('/settings/ai/xai/disconnect', {})
    expect(disconnect.status).toBe(200)
    expect((await admin.get('/settings')).body.xaiOauth).toEqual({ enabled: true, connected: false, account: null })

    expect(server.logs()).not.toContain('access-live')
    expect(server.logs()).not.toContain('refresh-live')
    expect(server.logs()).not.toContain('device-secret-do-not-leak')
  })

  it('requires an admin, and cancel stops a pending sign-in', async () => {
    const anon = new Client(server.baseUrl)
    expect((await anon.post('/settings/ai/xai/start', {})).status).toBe(401)

    const started = await admin.post('/settings/ai/xai/start', {})
    expect(started.status).toBe(200)
    expect((await admin.post('/settings/ai/xai/cancel', { pendingId: started.body.pendingId })).status).toBe(200)
    const poll = await admin.post('/settings/ai/xai/poll', { pendingId: started.body.pendingId })
    expect(poll.body.status).toBe('expired')
  })
})
