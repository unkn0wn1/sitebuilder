import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { createEmailHandler, resolveMailer, sendTestEmail } from '../server/services/email'
import { deleteSecret, secretKeyFromEnv, setSecret } from '../server/services/auth'
import {
  disconnectGoogle,
  finishGoogleConnect,
  gmailMailer,
  rfc822,
  setMailHttp,
  startGoogleConnect,
  type MailHttp,
} from '../server/services/gmail'
import { updateSettings, getSettings } from '../server/services/settings'
import { runJobsOnce } from '../server/services/jobs'
import { enqueueJob } from '../server/services/jobs'
import { setup } from './helpers'

const KEY = randomBytes(32).toString('base64')
const ORIGIN = 'https://builder.example.org'

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

function jsonHttp(routes: Record<string, { status?: number; body: unknown } | ((init?: RequestInit) => { status?: number; body: unknown })>): MailHttp {
  return async (url, init) => {
    const fn = routes[url]
    if (!fn) return { status: 404, json: async () => ({}), text: async () => 'not found' }
    const res = typeof fn === 'function' ? fn(init) : fn
    return {
      status: res.status ?? 200,
      json: async () => res.body,
      text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
    }
  }
}

describe('rfc822', () => {
  it('builds a plain message, and encodes a non-ascii subject', () => {
    const ascii = rfc822({ from: 'noreply@example.org', to: 'asha@example.org', subject: 'Reset your password', text: 'Hello\nThere' })
    expect(ascii).toContain('From: noreply@example.org')
    expect(ascii).toContain('To: asha@example.org')
    expect(ascii).toContain('Subject: Reset your password')
    expect(ascii).toContain('Hello\r\nThere')
    const encoded = rfc822({ from: 'noreply@example.org', to: 'a@b.c', subject: 'Café', text: 'Hi' })
    expect(encoded).toContain('Subject: =?UTF-8?B?')
    expect(encoded).not.toContain('Subject: Café')
  })
})

describe('Google Workspace mail transport', () => {
  beforeEach(() => {
    env('SITEBUILDER_SECRET_KEY', KEY)
    env('SITEBUILDER_ORIGIN', ORIGIN)
    env('SITEBUILDER_MAIL_OUTBOX', undefined)
    env('NODE_ENV', 'test')
    setMailHttp(undefined)
  })
  afterEach(() => {
    setMailHttp(undefined)
    restoreEnv()
  })

  function ready(s: ReturnType<typeof setup>) {
    updateSettings(s.ctx, s.admin, { mail: { googleClientId: '123.apps.googleusercontent.com', from: 'noreply@example.org' } })
    setSecret(s.ctx, secretKeyFromEnv(KEY), 'google_oauth_client_secret', 'client-secret', s.admin.id)
    return s
  }

  it('start is refused without client credentials, and the URL asks for offline gmail.send access', () => {
    const s = setup()
    expect(() => startGoogleConnect(s.ctx, s.admin)).toThrow(/client id/)
    ready(s)
    expect(() => startGoogleConnect(s.ctx, s.editor)).toThrow(AppError)
    const { url } = startGoogleConnect(s.ctx, s.admin)
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://accounts.google.com')
    expect(parsed.searchParams.get('client_id')).toBe('123.apps.googleusercontent.com')
    expect(parsed.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/settings/mail/google/callback`)
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    expect(parsed.searchParams.get('scope')).toContain('gmail.send')
    expect(parsed.searchParams.get('scope')).toContain('userinfo.email')
  })

  it('stores encrypted tokens on callback and uses them to send, refreshing when they expire', async () => {
    const s = ready(setup())
    const { url } = startGoogleConnect(s.ctx, s.admin)
    const state = new URL(url).searchParams.get('state')!

    let sent: { raw?: string; auth?: string } = {}
    let refreshCount = 0
    setMailHttp(
      jsonHttp({
        'https://oauth2.googleapis.com/token': (init) => {
          const body = new URLSearchParams(String(init?.body ?? ''))
          if (body.get('grant_type') === 'authorization_code') {
            expect(body.get('code')).toBe('auth-code')
            expect(body.get('client_secret')).toBe('client-secret')
            return { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } }
          }
          refreshCount++
          expect(body.get('refresh_token')).toBe('rt-1')
          return { body: { access_token: 'at-2', expires_in: 3600 } }
        },
        'https://www.googleapis.com/oauth2/v2/userinfo': { body: { email: 'noreply@example.org' } },
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send': (init) => {
          sent = { raw: JSON.parse(String(init?.body ?? '{}')).raw, auth: String((init?.headers as Record<string, string>)?.authorization) }
          if (sent.auth === 'Bearer at-1') return { status: 401, body: { error: 'expired' } }
          return { body: { id: 'msg-1' } }
        },
      }),
    )

    const connected = await finishGoogleConnect(s.ctx, s.admin, { code: 'auth-code', state })
    expect(connected.email).toBe('noreply@example.org')
    const settings = getSettings(s.ctx)
    expect(settings.mail).toMatchObject({ googleConnected: true, googleAccount: 'noreply@example.org', from: 'noreply@example.org', transport: 'gmail' })
    expect(JSON.stringify(settings)).not.toContain('rt-1')
    expect(JSON.stringify(settings)).not.toContain('at-1')
    expect(settings.secretsSet.google_oauth_client_secret).toBe(true)

    // Access token from the callback is already expired in this test's clock after we advance past expiry...
    // First send uses at-1, Gmail says 401, transport refreshes to at-2 and retries.
    const mailer = gmailMailer(s.ctx)
    expect(mailer).not.toBeNull()
    await mailer!.send({ to: 'asha@example.org', subject: 'Reset your password', text: 'Hello' })
    expect(sent.auth).toBe('Bearer at-2')
    expect(refreshCount).toBe(1)
    const mime = Buffer.from(sent.raw!, 'base64url').toString('utf8')
    expect(mime).toContain('From: noreply@example.org')
    expect(mime).toContain('To: asha@example.org')
    expect(mime).toContain('Reset your password')

    // Jobs use the same transport.
    enqueueJob(s.ctx, 'send_email', { kind: 'invite', userId: s.editor.id }) // editor is already active, skipped
    const invited = s.ctx.db.select().from((await import('../server/db/schema')).users).all().find((u) => u.email === 'asha@example.org')!
    // asha is active, invite would skip. Send a test instead.
    const test = await sendTestEmail(s.ctx, s.admin, 'priya@example.org')
    expect(test).toEqual({ sent: true, to: 'priya@example.org' })
  })

  it('refuses a callback meant for someone else, and disconnect clears the connection', async () => {
    const s = ready(setup())
    const { url } = startGoogleConnect(s.ctx, s.admin)
    const state = new URL(url).searchParams.get('state')!
    setMailHttp(
      jsonHttp({
        'https://oauth2.googleapis.com/token': { body: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
        'https://www.googleapis.com/oauth2/v2/userinfo': { body: { email: 'noreply@example.org' } },
      }),
    )
    await expect(finishGoogleConnect(s.ctx, s.editor, { code: 'x', state })).rejects.toThrow(/someone else/)
    await finishGoogleConnect(s.ctx, undefined, { code: 'x', state }) // no session cookie, signed state is enough
    expect(getSettings(s.ctx).mail.googleConnected).toBe(true)
    disconnectGoogle(s.ctx, s.admin)
    expect(getSettings(s.ctx).mail.googleConnected).toBe(false)
    expect(getSettings(s.ctx).mail.googleAccount).toBeNull()
    expect(gmailMailer(s.ctx)).toBeNull()
  })

  it('rejects a replay of the same signed OAuth state', async () => {
    const s = ready(setup())
    const { url } = startGoogleConnect(s.ctx, s.admin)
    const state = new URL(url).searchParams.get('state')!
    setMailHttp(
      jsonHttp({
        'https://oauth2.googleapis.com/token': { body: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
        'https://www.googleapis.com/oauth2/v2/userinfo': { body: { email: 'noreply@example.org' } },
      }),
    )
    await finishGoogleConnect(s.ctx, s.admin, { code: 'auth-code', state })
    await expect(finishGoogleConnect(s.ctx, s.admin, { code: 'auth-code-2', state })).rejects.toThrow(/already been used/)
  })

  it('resolveMailer prefers the outbox folder when SITEBUILDER_MAIL_OUTBOX is set, even if Gmail is connected', async () => {
    const s = ready(setup())
    setSecret(
      s.ctx,
      secretKeyFromEnv(KEY),
      'gmail_oauth',
      JSON.stringify({ refreshToken: 'rt', accessToken: 'at', expiry: new Date(s.clock.t + 60_000).toISOString(), email: 'noreply@example.org' }),
      s.admin.id,
    )
    const dir = mkdtempSync(join(tmpdir(), 'sb-outbox-'))
    env('SITEBUILDER_MAIL_OUTBOX', dir)
    const mailer = resolveMailer(s.ctx)
    await mailer!.send({ to: 'a@b.c', subject: 'Hi', text: 'Yo' })
    expect(readdirSync(dir)).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')).to).toBe('a@b.c')
  })

  it('skips sending in production when Google is not connected', async () => {
    env('NODE_ENV', 'production')
    env('SITEBUILDER_MAIL_OUTBOX', undefined)
    const s = setup()
    expect(resolveMailer(s.ctx)).toBeNull()
    enqueueJob(s.ctx, 'send_email', { kind: 'reset', userId: s.editor.id })
    const result = await runJobsOnce(s.ctx, { send_email: createEmailHandler({ getMailer: resolveMailer, baseUrl: ORIGIN }) })
    expect(result).toBe(1)
    await expect(sendTestEmail(s.ctx, s.admin)).rejects.toThrow(/Connect Google Workspace/)
  })
})
