// Wrap a request in the visitor's sandbox. Nitro does not keep AsyncLocalStorage
// across middleware, so this replaces the h3 handler after startup. Normal installs skip it.
// A plain visit does not mint a sandbox. Only a Turnstile-verified demo login does.
import { getCookie, getRequestHeader, readBody, send, sendRedirect, setCookie, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import type { MigrationFile } from '../db/migrate'
import { loadMigrationsFromDir } from '../db/migrations-fs'
import { AppError } from '../services/errors'
import { demoMode } from '../services/demo-mode'
import {
  DEMO_COOKIE,
  DEMO_IDLE_MS,
  cookieDomain,
  hasDemoMigrations,
  openExisting,
  openOrMint,
  runInSandbox,
  setDemoMigrations,
  touchSandbox,
  type Sandbox,
} from '../services/demo-sandbox'
import { assertDemoTurnstileConfigured, turnstileDisabled, verifyTurnstileRequest } from '../services/turnstile'

const SKIP = new Set(['/api/health', '/api/v1/health', '/favicon.ico', '/robots.txt'])

function skipSandbox(path: string): boolean {
  return SKIP.has(path) || path.startsWith('/_nuxt/')
}

function cookieSecure(event: H3Event): boolean {
  if (process.env.SITEBUILDER_INSECURE_COOKIES === '1') return false
  const proto = getRequestHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  if (proto === 'https') return true
  return (event.node.req.socket as { encrypted?: boolean }).encrypted === true
}

function setDemoCookie(event: H3Event, id: string) {
  const domain = cookieDomain(getRequestHeader(event, 'host'))
  setCookie(event, DEMO_COOKIE, id, {
    httpOnly: true,
    secure: cookieSecure(event),
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_IDLE_MS / 1000,
    ...(domain ? { domain } : {}),
  })
}

async function ensureMigrations() {
  if (hasDemoMigrations()) return
  try {
    const storage = useStorage('assets:migrations')
    const keys = (await storage.getKeys()).filter((key) => key.endsWith('.sql'))
    const files: MigrationFile[] = []
    for (const key of keys) files.push({ name: key, sql: String(await storage.getItem(key)) })
    if (files.length) {
      setDemoMigrations(files)
      return
    }
  } catch {
    // Tests and the CLI load migrations from disk.
  }
  try {
    setDemoMigrations(loadMigrationsFromDir())
  } catch {
    // The golden open reports a missing snapshot if this also fails.
  }
}

async function sendJson(event: H3Event, status: number, body: unknown) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  await send(event, JSON.stringify(body))
}

async function enterSandbox(event: H3Event, sandbox: Sandbox, previous: (event: H3Event) => Promise<unknown> | unknown) {
  touchSandbox(sandbox)
  setDemoCookie(event, sandbox.id)
  return runInSandbox(sandbox, () => previous(event))
}

export default defineNitroPlugin((nitro) => {
  if (!demoMode()) return
  assertDemoTurnstileConfigured()
  const previous = nitro.h3App.handler
  nitro.h3App.handler = async (event) => {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    const path = event.path.split('?')[0] ?? '/'
    if (path === '/robots.txt') {
      setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
      // toNodeListener ignores this handler's return value. A returned string never reaches the socket.
      await send(event, 'User-agent: *\nDisallow: /\n')
      return
    }
    if (skipSandbox(path)) return previous(event)
    // The gateway is off in demo mode and answers 404 without a database.
    if (path === '/agent' || path.startsWith('/agent/')) return previous(event)
    try {
      await ensureMigrations()
      const cookie = getCookie(event, DEMO_COOKIE) ?? null
      if (event.method === 'POST' && path === '/api/v1/auth/login') {
        if (!turnstileDisabled()) {
          const verdict = await verifyTurnstileRequest(event)
          if (!verdict.ok) {
            await sendJson(event, verdict.status, verdict.body)
            return
          }
        } else {
          // Read the body so the login handler sees the cached parse. Disabled skips the check.
          await readBody(event).catch(() => undefined)
        }
        const result = openOrMint(cookie)
        if (!result.ok) {
          setResponseStatus(event, 503)
          setResponseHeader(event, 'retry-after', 60)
          setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
          await send(event, '<!doctype html><title>Demo is full</title><p>The demo is full. Try again shortly.</p>')
          return
        }
        return enterSandbox(event, result.sandbox, previous)
      }
      const existing = openExisting(cookie)
      if (existing) return enterSandbox(event, existing, previous)
      if ((event.method === 'GET' || event.method === 'HEAD') && path === '/api/v1/demo/status') return previous(event)
      if (path === '/api' || path.startsWith('/api/')) {
        await sendJson(event, 401, { error: { code: 'unauthenticated', message: 'Please sign in.' } })
        return
      }
      if (path === '/login' && (event.method === 'GET' || event.method === 'HEAD')) return previous(event)
      const next = event.path.startsWith('/') ? event.path : `/${event.path}`
      await sendRedirect(event, `/login?next=${encodeURIComponent(next)}`, 302)
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_set_up') {
        setResponseStatus(event, 503)
        setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
        await send(event, error.message)
        return
      }
      throw error
    }
  }
  nitro.hooks.hook('render:html', (html) => {
    html.head.push('<meta name="robots" content="noindex, nofollow">')
  })
})
