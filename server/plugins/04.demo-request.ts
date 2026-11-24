// Wrap every request in the visitor's sandbox. Nitro does not keep AsyncLocalStorage
// across middleware, so this replaces the h3 handler after startup. Normal installs skip it.
import { getCookie, getRequestHeader, setCookie, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import type { MigrationFile } from '../db/migrate'
import { loadMigrationsFromDir } from '../db/migrations-fs'
import { AppError } from '../services/errors'
import { demoMode } from '../services/demo-mode'
import {
  DEMO_COOKIE,
  DEMO_IDLE_MS,
  cookieDomain,
  hasDemoMigrations,
  openOrMint,
  runInSandbox,
  setDemoMigrations,
  touchSandbox,
} from '../services/demo-sandbox'

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

export default defineNitroPlugin((nitro) => {
  if (!demoMode()) return
  const previous = nitro.h3App.handler
  nitro.h3App.handler = async (event) => {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    const path = event.path.split('?')[0] ?? '/'
    if (path === '/robots.txt') {
      setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
      return 'User-agent: *\nDisallow: /\n'
    }
    if (skipSandbox(path)) return previous(event)
    try {
      await ensureMigrations()
      const cookie = getCookie(event, DEMO_COOKIE) ?? null
      const result = openOrMint(cookie)
      if (!result.ok) {
        setResponseStatus(event, 503)
        setResponseHeader(event, 'retry-after', 60)
        setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
        return '<!doctype html><title>Demo is full</title><p>The demo is full. Try again shortly.</p>'
      }
      touchSandbox(result.sandbox)
      const domain = cookieDomain(getRequestHeader(event, 'host'))
      setCookie(event, DEMO_COOKIE, result.sandbox.id, {
        httpOnly: true,
        secure: cookieSecure(event),
        sameSite: 'lax',
        path: '/',
        maxAge: DEMO_IDLE_MS / 1000,
        ...(domain ? { domain } : {}),
      })
      return runInSandbox(result.sandbox, () => previous(event))
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_set_up') {
        setResponseStatus(event, 503)
        setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
        return error.message
      }
      throw error
    }
  }
  nitro.hooks.hook('render:html', (html) => {
    html.head.push('<meta name="robots" content="noindex, nofollow">')
  })
})
