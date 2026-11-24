// Optional "Sign in with xAI" (device code, RFC 8628). Off unless SITEBUILDER_ENABLE_XAI_OAUTH=1.
// See docs/decisions/0016-xai-oauth.md.
import { randomBytes } from 'node:crypto'
import { audit } from './audit'
import { deleteSecret, getSecret, hasSecret, secretKeyFromEnv, setSecret } from './auth'
import { iso, type ActingAs, type ServiceCtx } from './context'
import { AppError } from './errors'
import { can } from '../../shared/roles'

export const XAI_DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration'
export const XAI_ISSUER = 'https://auth.x.ai'
export const XAI_API_BASE = 'https://api.x.ai/v1'
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
export const XAI_OAUTH_SCOPES = 'openid profile email offline_access grok-cli:access api:access'

// Public client used by Grok CLI / Hermes Agent and other community tools.
// xAI has no public console for registering a third-party OAuth app, and this
// client's allowlisted redirect is a loopback URL that a hosted admin cannot
// use. Device code does not need that redirect. Override with
// SITEBUILDER_XAI_OAUTH_CLIENT_ID once we have our own client. Do not treat
// this as a Skewstone-registered app.
export const PUBLIC_XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'

const SUBSCRIPTION_DENIED =
  'xAI refused this sign-in for your subscription tier. You can still paste an API key in Settings > AI.'
const REAUTH_NEEDED = 'Sign in with xAI again, or paste an API key in Settings > AI.'
const REQUEST_TIMEOUT_MS = 20_000
const REFRESH_SKEW_MS = 60_000

export interface XaiOauthTokens {
  refreshToken: string
  accessToken: string
  expiry: string
  email: string | null
}

export interface XaiDeviceStart {
  pendingId: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string | null
  expiresIn: number
  interval: number
}

export type XaiDevicePoll =
  | { status: 'pending'; interval: number }
  | { status: 'connected'; account: string | null }
  | { status: 'expired'; message: string }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string }

export interface XaiOauthStatus {
  enabled: boolean
  connected: boolean
  account: string | null
}

export type OauthHttp = (url: string, init?: RequestInit) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

const defaultHttp: OauthHttp = async (url, init) => {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  return { status: res.status, json: () => res.json(), text: () => res.text() }
}

let http: OauthHttp = defaultHttp
let discoveryCache: { url: string; endpoints: Discovered; fetchedAt: number } | null = null

interface Discovered {
  issuer: string
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint: string | null
  userinfoEndpoint: string | null
}

interface PendingDevice {
  deviceCode: string
  intervalMs: number
  expiresAt: number
  userId: string
  siteId: string
  lastPollAt: number
}

const pending = new Map<string, PendingDevice>()

/** Tests only. */
export function setXaiOauthHttp(fn: OauthHttp | undefined) {
  http = fn ?? defaultHttp
}

/** Tests only. */
export function resetXaiOauthForTests() {
  http = defaultHttp
  discoveryCache = null
  pending.clear()
}

export function isXaiOauthEnabled(): boolean {
  return process.env.SITEBUILDER_ENABLE_XAI_OAUTH === '1'
}

export function xaiOauthClientId(): string {
  const override = process.env.SITEBUILDER_XAI_OAUTH_CLIENT_ID?.trim()
  return override || PUBLIC_XAI_OAUTH_CLIENT_ID
}

export function xaiOauthDiscoveryUrl(): string {
  return process.env.SITEBUILDER_XAI_OAUTH_DISCOVERY_URL?.trim() || XAI_DISCOVERY_URL
}

export function requireXaiOauthEnabled() {
  if (!isXaiOauthEnabled()) throw new AppError('not_found', 'Not found.')
}

function secretKey(): Buffer {
  return secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
}

function requireManage(actor: ActingAs) {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw new AppError('forbidden', "You don't have permission to do that.")
}

export function isXaiOauthConnected(ctx: ServiceCtx): boolean {
  return isXaiOauthEnabled() && hasSecret(ctx, 'xai_oauth')
}

export function readXaiOauthTokens(ctx: ServiceCtx, key: Buffer): XaiOauthTokens | null {
  const raw = getSecret(ctx, key, 'xai_oauth')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as XaiOauthTokens
    if (!parsed.refreshToken || !parsed.accessToken) return null
    return { refreshToken: parsed.refreshToken, accessToken: parsed.accessToken, expiry: parsed.expiry, email: parsed.email ?? null }
  } catch {
    return null
  }
}

export function xaiOauthStatus(ctx: ServiceCtx): XaiOauthStatus {
  const enabled = isXaiOauthEnabled()
  if (!enabled) return { enabled: false, connected: false, account: null }
  try {
    const tokens = readXaiOauthTokens(ctx, secretKey())
    return { enabled: true, connected: !!tokens, account: tokens?.email ?? null }
  } catch {
    return { enabled: true, connected: hasSecret(ctx, 'xai_oauth'), account: null }
  }
}

function expectedIssuer(discoveryUrl: string): string {
  if (discoveryUrl === XAI_DISCOVERY_URL) return XAI_ISSUER
  return new URL(discoveryUrl).origin
}

function assertEndpoint(value: unknown, name: string, discoveryUrl: string): string {
  if (typeof value !== 'string' || !value) throw new AppError('not_set_up', `xAI sign-in is misconfigured (${name} is missing).`)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AppError('not_set_up', `xAI sign-in is misconfigured (${name} is not a valid address).`)
  }
  const discovery = new URL(discoveryUrl)
  if (discovery.protocol === 'https:' && parsed.protocol !== 'https:') {
    throw new AppError('not_set_up', `xAI sign-in is misconfigured (${name} must use https).`)
  }
  if (parsed.origin !== discovery.origin && parsed.origin !== XAI_ISSUER) {
    throw new AppError('not_set_up', `xAI sign-in is misconfigured (${name} is on an unexpected host).`)
  }
  return value
}

async function discover(): Promise<Discovered> {
  const url = xaiOauthDiscoveryUrl()
  const now = Date.now()
  if (discoveryCache && discoveryCache.url === url && now - discoveryCache.fetchedAt < 60 * 60_000) return discoveryCache.endpoints
  const res = await http(url, { headers: { accept: 'application/json' } })
  if (res.status >= 400) throw new AppError('not_set_up', 'Could not reach xAI to start sign-in. Try again in a moment.')
  const body = (await res.json()) as Record<string, unknown>
  const issuer = typeof body.issuer === 'string' ? body.issuer.replace(/\/$/, '') : ''
  if (issuer !== expectedIssuer(url)) throw new AppError('not_set_up', 'xAI sign-in is misconfigured (issuer mismatch).')
  const endpoints: Discovered = {
    issuer,
    deviceAuthorizationEndpoint: assertEndpoint(body.device_authorization_endpoint, 'device_authorization_endpoint', url),
    tokenEndpoint: assertEndpoint(body.token_endpoint, 'token_endpoint', url),
    revocationEndpoint: body.revocation_endpoint ? assertEndpoint(body.revocation_endpoint, 'revocation_endpoint', url) : null,
    userinfoEndpoint: body.userinfo_endpoint ? assertEndpoint(body.userinfo_endpoint, 'userinfo_endpoint', url) : null,
  }
  discoveryCache = { url, endpoints, fetchedAt: now }
  return endpoints
}

async function postForm(url: string, body: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await http(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
    } catch {
      data = {}
    }
  }
  return { status: res.status, data }
}

function oauthErrorMessage(data: Record<string, unknown>, fallback: string): string {
  const description = typeof data.error_description === 'string' ? data.error_description : ''
  const code = typeof data.error === 'string' ? data.error : ''
  if (/permission|not have permission|forbidden|403/i.test(description) || code === 'access_denied') return SUBSCRIPTION_DENIED
  // Never return raw token payloads; only short, known error text.
  if (description && description.length <= 200 && !/access_token|refresh_token/i.test(description)) return description
  return fallback
}

export async function startXaiDeviceLogin(ctx: ServiceCtx, actor: ActingAs): Promise<XaiDeviceStart> {
  requireXaiOauthEnabled()
  requireManage(actor)
  const endpoints = await discover()
  const { status, data } = await postForm(endpoints.deviceAuthorizationEndpoint, {
    client_id: xaiOauthClientId(),
    scope: XAI_OAUTH_SCOPES,
  })
  if (status >= 400) throw new AppError('not_set_up', oauthErrorMessage(data, 'xAI could not start sign-in. Try again, or paste an API key instead.'))
  const deviceCode = typeof data.device_code === 'string' ? data.device_code : ''
  const userCode = typeof data.user_code === 'string' ? data.user_code : ''
  const verificationUri = typeof data.verification_uri === 'string' ? data.verification_uri : ''
  const verificationUriComplete = typeof data.verification_uri_complete === 'string' ? data.verification_uri_complete : null
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in)
  const interval = typeof data.interval === 'number' ? data.interval : Number(data.interval ?? 5)
  if (!deviceCode || !userCode || !verificationUri || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new AppError('not_set_up', 'xAI did not return a sign-in code. Try again, or paste an API key instead.')
  }
  const pendingId = randomBytes(16).toString('hex')
  const intervalSec = Number.isFinite(interval) && interval >= 0 ? interval : 5
  pending.set(pendingId, {
    deviceCode,
    intervalMs: intervalSec * 1000,
    expiresAt: ctx.now().getTime() + expiresIn * 1000,
    userId: actor.id,
    siteId: ctx.siteId,
    lastPollAt: 0,
  })
  return {
    pendingId,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval: intervalSec,
  }
}

export async function pollXaiDeviceLogin(ctx: ServiceCtx, actor: ActingAs, pendingId: string): Promise<XaiDevicePoll> {
  requireXaiOauthEnabled()
  requireManage(actor)
  const row = pending.get(pendingId)
  if (!row || row.userId !== actor.id || row.siteId !== ctx.siteId) {
    return { status: 'expired', message: 'That sign-in has ended. Start again.' }
  }
  const now = ctx.now().getTime()
  if (now >= row.expiresAt) {
    pending.delete(pendingId)
    return { status: 'expired', message: 'The sign-in code expired. Start again.' }
  }
  const wait = row.lastPollAt ? row.lastPollAt + row.intervalMs - now : 0
  if (wait > 0) return { status: 'pending', interval: Math.max(0, Math.ceil(wait / 1000)) }
  row.lastPollAt = now
  const endpoints = await discover()
  const { status, data } = await postForm(endpoints.tokenEndpoint, {
    grant_type: DEVICE_CODE_GRANT,
    device_code: row.deviceCode,
    client_id: xaiOauthClientId(),
  })
  const error = typeof data.error === 'string' ? data.error : ''
  if (error === 'authorization_pending') return { status: 'pending', interval: Math.max(0, Math.round(row.intervalMs / 1000)) }
  if (error === 'slow_down') {
    row.intervalMs += 5000
    return { status: 'pending', interval: Math.max(0, Math.round(row.intervalMs / 1000)) }
  }
  if (error === 'expired_token') {
    pending.delete(pendingId)
    return { status: 'expired', message: 'The sign-in code expired. Start again.' }
  }
  if (error === 'access_denied') {
    pending.delete(pendingId)
    return { status: 'denied', message: 'Sign-in was declined. You can still paste an API key in Settings > AI.' }
  }
  if (status >= 400 || error) {
    pending.delete(pendingId)
    const message = oauthErrorMessage(data, 'xAI could not finish sign-in. Try again, or paste an API key instead.')
    return { status: 'error', message }
  }
  const tokens = tokensFromResponse(ctx, data)
  if (!tokens) {
    pending.delete(pendingId)
    return { status: 'error', message: 'xAI did not return the tokens needed to stay signed in. Try again, or paste an API key instead.' }
  }
  let email = tokens.email
  if (!email && endpoints.userinfoEndpoint) email = await readEmail(endpoints.userinfoEndpoint, tokens.accessToken)
  const stored: XaiOauthTokens = { ...tokens, email }
  setSecret(ctx, secretKey(), 'xai_oauth', JSON.stringify(stored), actor.id)
  pending.delete(pendingId)
  audit(ctx, actor, 'xai.oauth.connected', { type: 'site', id: ctx.siteId }, { account: email })
  return { status: 'connected', account: email }
}

export function cancelXaiDeviceLogin(ctx: ServiceCtx, actor: ActingAs, pendingId: string): { ok: true } {
  requireXaiOauthEnabled()
  requireManage(actor)
  const row = pending.get(pendingId)
  if (row && row.userId === actor.id && row.siteId === ctx.siteId) pending.delete(pendingId)
  return { ok: true }
}

export async function disconnectXaiOauth(ctx: ServiceCtx, actor: ActingAs): Promise<{ ok: true }> {
  requireXaiOauthEnabled()
  requireManage(actor)
  const key = secretKey()
  const tokens = readXaiOauthTokens(ctx, key)
  if (tokens) {
    try {
      const endpoints = await discover()
      if (endpoints.revocationEndpoint) {
        await postForm(endpoints.revocationEndpoint, { token: tokens.refreshToken, client_id: xaiOauthClientId(), token_type_hint: 'refresh_token' })
      }
    } catch {
      // Still drop the local tokens if revoke fails.
    }
  }
  deleteSecret(ctx, 'xai_oauth')
  audit(ctx, actor, 'xai.oauth.disconnected', { type: 'site', id: ctx.siteId }, {})
  return { ok: true }
}

function tokensFromResponse(ctx: ServiceCtx, data: Record<string, unknown>): XaiOauthTokens | null {
  const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in ?? 3600)
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return {
    accessToken,
    refreshToken,
    expiry: new Date(ctx.now().getTime() + expiresIn * 1000).toISOString(),
    email: null,
  }
}

async function readEmail(userinfoEndpoint: string, accessToken: string): Promise<string | null> {
  try {
    const res = await http(userinfoEndpoint, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
    if (res.status >= 400) return null
    const body = (await res.json()) as Record<string, unknown>
    return typeof body.email === 'string' && body.email.includes('@') ? body.email : null
  } catch {
    return null
  }
}

export async function refreshXaiOauthTokens(ctx: ServiceCtx, key: Buffer, current: XaiOauthTokens): Promise<XaiOauthTokens> {
  const endpoints = await discover()
  const { status, data } = await postForm(endpoints.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: xaiOauthClientId(),
  })
  if (status === 403) throw new AppError('ai_unavailable', SUBSCRIPTION_DENIED)
  if (status >= 400) {
    const code = typeof data.error === 'string' ? data.error : ''
    if (status === 401 || code === 'invalid_grant' || /invalid_grant|revoked/i.test(String(data.error_description ?? ''))) {
      throw new AppError('ai_unavailable', REAUTH_NEEDED)
    }
    if (status === 403) throw new AppError('ai_unavailable', SUBSCRIPTION_DENIED)
    throw new AppError('ai_unavailable', oauthErrorMessage(data, REAUTH_NEEDED))
  }
  const next = tokensFromResponse(ctx, data)
  if (!next) throw new AppError('ai_unavailable', REAUTH_NEEDED)
  const stored: XaiOauthTokens = {
    accessToken: next.accessToken,
    refreshToken: next.refreshToken || current.refreshToken,
    expiry: next.expiry,
    email: current.email,
  }
  setSecret(ctx, key, 'xai_oauth', JSON.stringify(stored), 'system')
  return stored
}

export async function xaiOauthAccessToken(ctx: ServiceCtx, opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const key = secretKey()
  let tokens = readXaiOauthTokens(ctx, key)
  if (!tokens) throw new AppError('ai_unavailable', 'Sign in with xAI, or paste an API key, in Settings > AI.')
  if (!opts.forceRefresh && new Date(tokens.expiry).getTime() - REFRESH_SKEW_MS > ctx.now().getTime()) return tokens.accessToken
  tokens = await refreshXaiOauthTokens(ctx, key, tokens)
  return tokens.accessToken
}

export function xaiOauthDeniedMessage(status?: number, message?: string): string | null {
  if (status === 403 || /permission|not have permission|forbidden/i.test(message ?? '')) return SUBSCRIPTION_DENIED
  if (status === 401) return REAUTH_NEEDED
  return null
}

export function pruneExpiredXaiDeviceLogins(now = Date.now()) {
  for (const [id, row] of pending) {
    if (row.expiresAt <= now) pending.delete(id)
  }
}
