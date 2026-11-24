// Demo login check. Cloudflare Turnstile, verified before a sandbox is minted.
// The secret is never logged. Production always calls Cloudflare unless a test
// process opts into a loopback stub. The public demo must not set that flag.
import { randomUUID } from 'node:crypto'
import { getRequestHeader, readBody, type H3Event } from 'h3'
import { clientIp } from '../utils/client-ip'

const REAL_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Documented dummy secrets. siteverify reports hostname "example.com" for these,
// which is not the request Host, so the hostname check does not apply to them.
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

const REJECT = { error: { code: 'turnstile_failed' as const, message: 'Complete the check, then sign in.' } }
const CLOSED = { error: { code: 'turnstile_failed' as const, message: 'The check could not be completed. Try again.' } }

export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 503; body: { error: { code: 'turnstile_failed'; message: string } } }

export function turnstileDisabled(): boolean {
  return process.env.SITEBUILDER_TURNSTILE_DISABLED === '1'
}

export function assertDemoTurnstileConfigured(): void {
  if (process.env.SITEBUILDER_DEMO_MODE !== '1') return
  if (turnstileDisabled()) return
  if (!process.env.SITEBUILDER_TURNSTILE_SECRET_KEY?.trim()) {
    throw new Error(
      'Demo mode requires SITEBUILDER_TURNSTILE_SECRET_KEY. Set SITEBUILDER_TURNSTILE_DISABLED=1 only for local development. The secret lives in the host .env (mode 600), not in the repo.',
    )
  }
}

function loopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/** Cloudflare's siteverify URL, or a loopback stub when a test explicitly allows it. */
export function turnstileVerifyEndpoint(): string {
  const override = process.env.SITEBUILDER_TURNSTILE_VERIFY_URL?.trim()
  if (!override) return REAL_URL
  if (process.env.NODE_ENV !== 'production') return override
  // Production ignores a custom URL. The built test server may set
  // SITEBUILDER_TURNSTILE_ALLOW_STUB=1 and point at loopback. Do not set that on the public demo.
  if (process.env.SITEBUILDER_TURNSTILE_ALLOW_STUB === '1' && loopbackUrl(override)) return override
  return REAL_URL
}

export async function verifyTurnstileToken(opts: {
  token: string | undefined
  secret: string
  remoteip: string | null
  host: string | undefined
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}): Promise<TurnstileVerdict> {
  const token = opts.token?.trim() ?? ''
  if (!token) return { ok: false, status: 403, body: REJECT }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const form = new URLSearchParams({ secret: opts.secret, response: token, idempotency_key: randomUUID() })
  if (opts.remoteip) form.set('remoteip', opts.remoteip)
  let response: Response
  try {
    response = await fetchImpl(turnstileVerifyEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    return { ok: false, status: 503, body: CLOSED }
  }
  let data: { success?: unknown; hostname?: unknown }
  try {
    data = (await response.json()) as { success?: unknown; hostname?: unknown }
  } catch {
    return { ok: false, status: 503, body: CLOSED }
  }
  if (data.success !== true) return { ok: false, status: 403, body: REJECT }
  if (typeof data.hostname === 'string' && data.hostname && !TEST_SECRETS.has(opts.secret)) {
    const host = (opts.host ?? '').split(':')[0]!.trim().toLowerCase()
    if (data.hostname.toLowerCase() !== host) return { ok: false, status: 403, body: REJECT }
  }
  return { ok: true }
}

export async function verifyTurnstileRequest(event: H3Event): Promise<TurnstileVerdict> {
  const body = await readBody(event).catch(() => undefined)
  const raw = body && typeof body === 'object' ? (body as { turnstileToken?: unknown }).turnstileToken : undefined
  return verifyTurnstileToken({
    token: typeof raw === 'string' ? raw : undefined,
    secret: process.env.SITEBUILDER_TURNSTILE_SECRET_KEY?.trim() ?? '',
    remoteip: clientIp(event),
    host: getRequestHeader(event, 'host'),
  })
}
