// Google Workspace mail via the Gmail API and OAuth (ADR 0015).
// Tokens are stored encrypted. The assistant and the secrets API cannot write them.
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { sites, users } from '../db/schema'
import { audit } from './audit'
import { deleteSecret, getSecret, hasSecret, secretKeyFromEnv, setSecret } from './auth'
import { iso, type ActingAs, type ServiceCtx } from './context'
import type { EmailMessage, Mailer } from './email'
import { AppError, forbidden } from './errors'
import { readSettings } from '../../shared/settings'
import { can } from '../../shared/roles'

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'
export const GMAIL_SCOPES = `${GMAIL_SEND_SCOPE} ${GMAIL_EMAIL_SCOPE}`
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const STATE_TTL_MS = 10 * 60_000

export interface GmailTokens {
  refreshToken: string
  accessToken: string
  expiry: string
  email: string
}

/** Narrow hook so tests can fake Google without adding a mock library. */
export type MailHttp = (url: string, init?: RequestInit) => Promise<{ status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

const defaultHttp: MailHttp = async (url, init) => {
  const res = await fetch(url, init)
  return { status: res.status, json: () => res.json(), text: () => res.text() }
}

let http: MailHttp = defaultHttp

/** Tests only. */
export function setMailHttp(fn: MailHttp | undefined) {
  http = fn ?? defaultHttp
}

export function builderOrigin(): string {
  return (process.env.SITEBUILDER_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')
}

export function googleCallbackUrl(): string {
  return `${builderOrigin()}/api/v1/settings/mail/google/callback`
}

function secretKey(): Buffer {
  return secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY)
}

export function googleClientId(ctx: ServiceCtx): string | null {
  return readSettings(ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()?.settings).mail.googleClientId
    || process.env.SITEBUILDER_GOOGLE_OAUTH_CLIENT_ID
    || null
}

function googleClientSecret(ctx: ServiceCtx, key: Buffer): string | null {
  return getSecret(ctx, key, 'google_oauth_client_secret') || process.env.SITEBUILDER_GOOGLE_OAUTH_CLIENT_SECRET || null
}

export function isGmailConnected(ctx: ServiceCtx): boolean {
  return hasSecret(ctx, 'gmail_oauth')
}

export function readGmailTokens(ctx: ServiceCtx, key: Buffer): GmailTokens | null {
  const raw = getSecret(ctx, key, 'gmail_oauth')
  if (!raw) return null
  const parsed = JSON.parse(raw) as GmailTokens
  if (!parsed.refreshToken || !parsed.accessToken || !parsed.email) return null
  return parsed
}

function signState(payload: object, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${mac}`
}

function readState(state: string, key: Buffer): { userId: string; iat: number } {
  const [body, mac] = state.split('.')
  if (!body || !mac) throw new AppError('validation_failed', 'That Google sign-in link is not valid. Start again from Settings.')
  const expected = createHmac('sha256', key).update(body).digest('base64url')
  if (expected.length !== mac.length || !timingSafeEqualString(expected, mac)) {
    throw new AppError('validation_failed', 'That Google sign-in link is not valid. Start again from Settings.')
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { userId?: string; iat?: number; purpose?: string }
  if (payload.purpose !== 'gmail_oauth' || !payload.userId || !payload.iat) {
    throw new AppError('validation_failed', 'That Google sign-in link is not valid. Start again from Settings.')
  }
  if (Date.now() - payload.iat > STATE_TTL_MS) {
    throw new AppError('validation_failed', 'That Google sign-in link has expired. Start again from Settings.')
  }
  return { userId: payload.userId, iat: payload.iat }
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!
  return diff === 0
}

export function startGoogleConnect(ctx: ServiceCtx, actor: ActingAs): { url: string } {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  const clientId = googleClientId(ctx)
  if (!clientId) throw new AppError('not_set_up', 'Add a Google OAuth client id in Settings first.')
  let key: Buffer
  try {
    key = secretKey()
  } catch {
    throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY is not set on the server, so Google Workspace cannot be connected yet.')
  }
  if (!googleClientSecret(ctx, key)) throw new AppError('not_set_up', 'Add the Google OAuth client secret in Settings first.')
  const state = signState({ purpose: 'gmail_oauth', userId: actor.id, iat: Date.now() }, key)
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', googleCallbackUrl())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GMAIL_SCOPES)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'false')
  url.searchParams.set('state', state)
  return { url: url.toString() }
}

export async function finishGoogleConnect(ctx: ServiceCtx, actor: ActingAs | undefined, input: { code?: string; state?: string; error?: string }): Promise<{ email: string }> {
  if (input.error) throw new AppError('validation_failed', 'Google sign-in was cancelled. You can try again from Settings.')
  if (!input.code || !input.state) throw new AppError('validation_failed', 'That Google sign-in link is not valid. Start again from Settings.')
  let key: Buffer
  try {
    key = secretKey()
  } catch {
    throw new AppError('not_set_up', 'SITEBUILDER_SECRET_KEY is not set on the server.')
  }
  const state = readState(input.state, key)
  const user = ctx.db.select().from(users).where(eq(users.id, state.userId)).get()
  if (!user || user.status !== 'active' || !can({ role: user.role, isOperator: user.isOperator }, 'settings.manage')) {
    throw forbidden('That Google sign-in is no longer valid.')
  }
  if (actor && actor.id !== user.id) throw forbidden('That Google sign-in was started by someone else.')
  const clientId = googleClientId(ctx)
  const clientSecret = googleClientSecret(ctx, key)
  if (!clientId || !clientSecret) throw new AppError('not_set_up', 'The Google OAuth client is not configured.')

  const tokenRes = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleCallbackUrl(),
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (tokenRes.status >= 400) {
    throw new AppError('validation_failed', "Google didn't accept the sign-in. Start again from Settings.")
  }
  const tokenBody = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokenBody.access_token || !tokenBody.refresh_token) {
    throw new AppError('validation_failed', 'Google did not return a refresh token. Start again and allow offline access.')
  }
  const infoRes = await http(USERINFO_URL, { headers: { authorization: `Bearer ${tokenBody.access_token}` } })
  if (infoRes.status >= 400) throw new AppError('validation_failed', "We couldn't read the Google account email.")
  const info = (await infoRes.json()) as { email?: string }
  const email = info.email?.trim().toLowerCase()
  if (!email) throw new AppError('validation_failed', "We couldn't read the Google account email.")

  const expiry = new Date(ctx.now().getTime() + Math.max(60, tokenBody.expires_in ?? 3600) * 1000).toISOString()
  const tokens: GmailTokens = { refreshToken: tokenBody.refresh_token, accessToken: tokenBody.access_token, expiry, email }
  setSecret(ctx, key, 'gmail_oauth', JSON.stringify(tokens), user.id)
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(site.settings)
  const mail = { ...settings.mail, googleAccount: email, from: settings.mail.from ?? email }
  ctx.db.update(sites).set({ settings: { ...settings, mail } }).where(eq(sites.id, ctx.siteId)).run()
  const as: ActingAs = { id: user.id, role: user.role, isOperator: user.isOperator }
  audit(ctx, as, 'mail.google_connected', { type: 'site', id: ctx.siteId }, { email })
  return { email }
}

export function disconnectGoogle(ctx: ServiceCtx, actor: ActingAs) {
  if (actor.aiSessionId || !can(actor, 'settings.manage')) throw forbidden()
  deleteSecret(ctx, 'gmail_oauth')
  const site = ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(site.settings)
  ctx.db.update(sites).set({ settings: { ...settings, mail: { ...settings.mail, googleAccount: null } } }).where(eq(sites.id, ctx.siteId)).run()
  audit(ctx, actor, 'mail.google_disconnected', { type: 'site', id: ctx.siteId })
}

export function rfc822(message: EmailMessage & { from: string }): string {
  const subject = /^[\x20-\x7e]*$/.test(message.subject)
    ? message.subject
    : `=?UTF-8?B?${Buffer.from(message.subject, 'utf8').toString('base64')}?=`
  const text = message.text.replace(/\r?\n/g, '\r\n')
  return `From: ${message.from}\r\nTo: ${message.to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n`
}

async function refreshTokens(ctx: ServiceCtx, key: Buffer, current: GmailTokens): Promise<GmailTokens> {
  const clientId = googleClientId(ctx)
  const clientSecret = googleClientSecret(ctx, key)
  if (!clientId || !clientSecret) throw new AppError('not_set_up', 'The Google OAuth client is not configured.')
  const res = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })
  if (res.status >= 400) throw new AppError('not_set_up', 'The Google Workspace connection has expired. Reconnect it in Settings.')
  const body = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string }
  if (!body.access_token) throw new AppError('not_set_up', 'The Google Workspace connection has expired. Reconnect it in Settings.')
  const next: GmailTokens = {
    refreshToken: body.refresh_token || current.refreshToken,
    accessToken: body.access_token,
    expiry: new Date(ctx.now().getTime() + Math.max(60, body.expires_in ?? 3600) * 1000).toISOString(),
    email: current.email,
  }
  setSecret(ctx, key, 'gmail_oauth', JSON.stringify(next), 'system')
  return next
}

async function accessToken(ctx: ServiceCtx, key: Buffer, current: GmailTokens): Promise<GmailTokens> {
  if (new Date(current.expiry).getTime() - 30_000 > ctx.now().getTime()) return current
  return refreshTokens(ctx, key, current)
}

export function fromAddress(ctx: ServiceCtx, tokens: GmailTokens): string {
  const settings = readSettings(ctx.db.select().from(sites).where(eq(sites.id, ctx.siteId)).get()?.settings)
  return settings.mail.from || tokens.email
}

export function gmailMailer(ctx: ServiceCtx): Mailer | null {
  let key: Buffer
  try {
    key = secretKey()
  } catch {
    return null
  }
  if (!readGmailTokens(ctx, key) || !googleClientId(ctx) || !googleClientSecret(ctx, key)) return null
  return {
    async send(message) {
      let tokens = readGmailTokens(ctx, key)
      if (!tokens) throw new AppError('not_set_up', 'Google Workspace is not connected.')
      tokens = await accessToken(ctx, key, tokens)
      const raw = Buffer.from(rfc822({ ...message, from: message.from || fromAddress(ctx, tokens) }), 'utf8').toString('base64url')
      const sendOnce = (token: string) =>
        http(SEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ raw }),
        })
      let res = await sendOnce(tokens.accessToken)
      if (res.status === 401) {
        tokens = await refreshTokens(ctx, key, tokens)
        res = await sendOnce(tokens.accessToken)
      }
      if (res.status >= 400) {
        const body = await res.text()
        throw new AppError('invalid_state', "Google couldn't send that email. Try again, or reconnect Google Workspace in Settings.", undefined, { status: res.status, detail: body.slice(0, 300) })
      }
    },
  }
}
