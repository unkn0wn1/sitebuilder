import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { secretKeyFromEnv, setSecret, getSecret, hasSecret } from '../server/services/auth'
import { resolveAi, hasAiCredentials, testAiConnection } from '../server/services/ai-loop'
import { ProviderError, type ModelProvider } from '../server/services/ai-provider'
import { updateSettings } from '../server/services/settings'
import {
  PUBLIC_XAI_OAUTH_CLIENT_ID,
  cancelXaiDeviceLogin,
  disconnectXaiOauth,
  isXaiOauthEnabled,
  pollXaiDeviceLogin,
  readXaiOauthTokens,
  refreshXaiOauthTokens,
  requireXaiOauthEnabled,
  resetXaiOauthForTests,
  setXaiOauthHttp,
  startXaiDeviceLogin,
  xaiOauthAccessToken,
  xaiOauthClientId,
  xaiOauthDeniedMessage,
  xaiOauthStatus,
  type OauthHttp,
} from '../server/services/xai-oauth'
import { AppError } from '../server/services/errors'
import { setup } from './helpers'

const KEY = randomBytes(32).toString('base64')
const saved: Record<string, string | undefined> = {}

function env(name: string, value: string | undefined) {
  if (!(name in saved)) saved[name] = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

const DISCOVERY = 'http://127.0.0.1:9/.well-known/openid-configuration'
const DEVICE = 'http://127.0.0.1:9/oauth2/device/code'
const TOKEN = 'http://127.0.0.1:9/oauth2/token'
const REVOKE = 'http://127.0.0.1:9/oauth2/revoke'
const USERINFO = 'http://127.0.0.1:9/oauth2/userinfo'

function discoveryBody() {
  return {
    issuer: 'http://127.0.0.1:9',
    device_authorization_endpoint: DEVICE,
    token_endpoint: TOKEN,
    revocation_endpoint: REVOKE,
    userinfo_endpoint: USERINFO,
  }
}

function jsonHttp(routes: Record<string, { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown })>): OauthHttp {
  return async (url, init) => {
    const fn = routes[url]
    if (!fn) return { status: 404, json: async () => ({}), text: async () => 'not found' }
    const res = typeof fn === 'function' ? fn(init) : fn
    const body = res.body
    return {
      status: res.status ?? 200,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
}

function enable(s: ReturnType<typeof setup>) {
  env('SITEBUILDER_ENABLE_XAI_OAUTH', '1')
  env('SITEBUILDER_SECRET_KEY', KEY)
  env('SITEBUILDER_XAI_OAUTH_DISCOVERY_URL', DISCOVERY)
  env('SITEBUILDER_XAI_OAUTH_CLIENT_ID', 'test-client')
  env('SITEBUILDER_AI_PROVIDER', undefined)
  updateSettings(s.ctx, s.admin, { ai: { enabled: true, provider: 'xai', model: 'grok-4' } })
}

describe('xAI OAuth flag and client id', () => {
  afterEach(() => {
    resetXaiOauthForTests()
    restoreEnv()
  })

  it('is off by default, and 404s when used while off', () => {
    env('SITEBUILDER_ENABLE_XAI_OAUTH', undefined)
    expect(isXaiOauthEnabled()).toBe(false)
    expect(() => requireXaiOauthEnabled()).toThrow(AppError)
    try {
      requireXaiOauthEnabled()
    } catch (err) {
      expect(err).toMatchObject({ code: 'not_found', status: 404 })
    }
  })

  it('uses the public Grok CLI client unless SITEBUILDER_XAI_OAUTH_CLIENT_ID is set', () => {
    env('SITEBUILDER_XAI_OAUTH_CLIENT_ID', undefined)
    expect(xaiOauthClientId()).toBe(PUBLIC_XAI_OAUTH_CLIENT_ID)
    env('SITEBUILDER_XAI_OAUTH_CLIENT_ID', ' our-own-client ')
    expect(xaiOauthClientId()).toBe('our-own-client')
  })
})

describe('xAI device login, storage and refresh', () => {
  beforeEach(() => {
    resetXaiOauthForTests()
  })
  afterEach(() => {
    resetXaiOauthForTests()
    restoreEnv()
  })

  it('stores encrypted tokens after a successful device poll, refreshes them, and never returns them in status', async () => {
    const s = setup()
    enable(s)
    let tokenCalls = 0
    setXaiOauthHttp(
      jsonHttp({
        [DISCOVERY]: { body: discoveryBody() },
        [DEVICE]: {
          body: {
            device_code: 'device-secret',
            user_code: 'ABCD-EFGH',
            verification_uri: 'http://127.0.0.1:9/verify',
            verification_uri_complete: 'http://127.0.0.1:9/verify?user_code=ABCD-EFGH',
            expires_in: 600,
            interval: 0,
          },
        },
        [TOKEN]: (init) => {
          tokenCalls += 1
          const body = String(init?.body ?? '')
          if (body.includes('grant_type=refresh_token')) {
            expect(body).toContain('refresh_token=refresh-1')
            return { body: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 } }
          }
          if (tokenCalls === 1) return { status: 400, body: { error: 'authorization_pending' } }
          return { body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 } }
        },
        [USERINFO]: { body: { email: 'spencer@example.org' } },
      }),
    )

    const started = await startXaiDeviceLogin(s.ctx, s.admin)
    expect(started.userCode).toBe('ABCD-EFGH')
    expect(started.verificationUri).toBe('http://127.0.0.1:9/verify')
    expect(JSON.stringify(started)).not.toContain('device-secret')
    expect(JSON.stringify(started)).not.toContain('access-1')

    const pending = await pollXaiDeviceLogin(s.ctx, s.admin, started.pendingId)
    expect(pending).toEqual({ status: 'pending', interval: 0 })

    const connected = await pollXaiDeviceLogin(s.ctx, s.admin, started.pendingId)
    expect(connected).toEqual({ status: 'connected', account: 'spencer@example.org' })
    expect(JSON.stringify(connected)).not.toContain('access-1')
    expect(JSON.stringify(connected)).not.toContain('refresh-1')

    const status = xaiOauthStatus(s.ctx)
    expect(status).toEqual({ enabled: true, connected: true, account: 'spencer@example.org' })
    expect(hasSecret(s.ctx, 'xai_oauth')).toBe(true)
    const raw = getSecret(s.ctx, secretKeyFromEnv(KEY), 'xai_oauth')
    expect(raw).toContain('refresh-1')
    expect(JSON.stringify(status)).not.toContain('refresh-1')
    expect(hasAiCredentials(s.ctx, 'xai')).toBe(true)
    expect(resolveAi(s.ctx).reason).toBe('ready')

    const first = await xaiOauthAccessToken(s.ctx)
    expect(first).toBe('access-1')

    // Force expiry so the next call refreshes.
    const tokens = readXaiOauthTokens(s.ctx, secretKeyFromEnv(KEY))!
    setSecret(s.ctx, secretKeyFromEnv(KEY), 'xai_oauth', JSON.stringify({ ...tokens, expiry: '2020-01-01T00:00:00.000Z' }), s.admin.id)
    const refreshed = await refreshXaiOauthTokens(s.ctx, secretKeyFromEnv(KEY), readXaiOauthTokens(s.ctx, secretKeyFromEnv(KEY))!)
    expect(refreshed.accessToken).toBe('access-2')
    expect(refreshed.refreshToken).toBe('refresh-2')
    expect(getSecret(s.ctx, secretKeyFromEnv(KEY), 'xai_oauth')).toContain('refresh-2')
    s.sqlite.close()
  })

  it('surfaces a clear error when refresh is forbidden, and still lets you use an API key', async () => {
    const s = setup()
    enable(s)
    setXaiOauthHttp(
      jsonHttp({
        [DISCOVERY]: { body: discoveryBody() },
        [TOKEN]: { status: 403, body: { error: 'access_denied', error_description: 'The caller does not have permission to execute the specified operation' } },
      }),
    )
    setSecret(
      s.ctx,
      secretKeyFromEnv(KEY),
      'xai_oauth',
      JSON.stringify({ refreshToken: 'refresh-1', accessToken: 'access-1', expiry: '2020-01-01T00:00:00.000Z', email: 'spencer@example.org' }),
      s.admin.id,
    )
    await expect(refreshXaiOauthTokens(s.ctx, secretKeyFromEnv(KEY), readXaiOauthTokens(s.ctx, secretKeyFromEnv(KEY))!)).rejects.toMatchObject({
      code: 'ai_unavailable',
      message: expect.stringMatching(/subscription tier/i),
    })
    expect(xaiOauthDeniedMessage(403, 'The caller does not have permission')).toMatch(/API key/)
    s.sqlite.close()
  })

  it('cancels a pending device login and disconnects a stored session, including revoke', async () => {
    const s = setup()
    enable(s)
    let revoked = false
    setXaiOauthHttp(
      jsonHttp({
        [DISCOVERY]: { body: discoveryBody() },
        [DEVICE]: {
          body: { device_code: 'device-secret', user_code: 'CODE', verification_uri: 'http://127.0.0.1:9/verify', expires_in: 600, interval: 5 },
        },
        [REVOKE]: () => {
          revoked = true
          return { body: {} }
        },
      }),
    )
    const started = await startXaiDeviceLogin(s.ctx, s.admin)
    expect(cancelXaiDeviceLogin(s.ctx, s.admin, started.pendingId)).toEqual({ ok: true })
    const after = await pollXaiDeviceLogin(s.ctx, s.admin, started.pendingId)
    expect(after.status).toBe('expired')

    setSecret(
      s.ctx,
      secretKeyFromEnv(KEY),
      'xai_oauth',
      JSON.stringify({ refreshToken: 'refresh-1', accessToken: 'access-1', expiry: new Date(s.ctx.now().getTime() + 60_000).toISOString(), email: null }),
      s.admin.id,
    )
    await disconnectXaiOauth(s.ctx, s.admin)
    expect(revoked).toBe(true)
    expect(hasSecret(s.ctx, 'xai_oauth')).toBe(false)
    expect(xaiOauthStatus(s.ctx).connected).toBe(false)
    s.sqlite.close()
  })

  it('rejects a discovery document whose issuer does not match', async () => {
    const s = setup()
    enable(s)
    setXaiOauthHttp(jsonHttp({ [DISCOVERY]: { body: { ...discoveryBody(), issuer: 'https://evil.example' } } }))
    await expect(startXaiDeviceLogin(s.ctx, s.admin)).rejects.toMatchObject({ code: 'not_set_up', message: expect.stringMatching(/issuer/i) })
    s.sqlite.close()
  })

  it('an editor cannot start sign-in, and a connection test uses the OAuth token path', async () => {
    const s = setup()
    enable(s)
    setXaiOauthHttp(
      jsonHttp({
        [DISCOVERY]: { body: discoveryBody() },
        [DEVICE]: {
          body: { device_code: 'device-secret', user_code: 'CODE', verification_uri: 'http://127.0.0.1:9/verify', expires_in: 600, interval: 5 },
        },
      }),
    )
    await expect(startXaiDeviceLogin(s.ctx, s.editor)).rejects.toMatchObject({ code: 'forbidden' })

    setSecret(
      s.ctx,
      secretKeyFromEnv(KEY),
      'xai_oauth',
      JSON.stringify({ refreshToken: 'refresh-1', accessToken: 'access-1', expiry: new Date(s.ctx.now().getTime() + 120_000).toISOString(), email: null }),
      s.admin.id,
    )
    const provider: ModelProvider = {
      complete: async () => ({ message: { role: 'assistant', content: 'pong' }, usage: { tokensIn: 1, tokensOut: 1 } }),
    }
    const result = await testAiConnection(s.ctx, { provider })
    expect(result.reply).toBe('pong')
    s.sqlite.close()
  })
})

describe('xAI OAuth error copy', () => {
  it('maps 403 to the API key fallback, and 401 to signing in again', () => {
    expect(xaiOauthDeniedMessage(403, 'no permission')).toMatch(/API key/)
    expect(xaiOauthDeniedMessage(401)).toMatch(/Sign in with xAI again/)
    expect(xaiOauthDeniedMessage(500, 'boom')).toBeNull()
    expect(new ProviderError('denied', 403).status).toBe(403)
  })
})
