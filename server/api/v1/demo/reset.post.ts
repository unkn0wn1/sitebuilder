import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getCookie, setCookie, setResponseHeader, setResponseStatus } from 'h3'
import { DEMO_EMAIL } from '../../../../shared/demo'
import { createSession } from '../../../services/auth'
import { demoMode } from '../../../services/demo-mode'
import { DEMO_COOKIE, DEMO_IDLE_MS, cookieDomain, currentSandbox, resetDemoSandbox, runInSandbox } from '../../../services/demo-sandbox'
import { AppError } from '../../../services/errors'
import { users } from '../../../db/schema'
import { secureCookies, SESSION_COOKIE } from '../../../utils/api'
import { clientIp } from '../../../utils/client-ip'
import { hit } from '../../../utils/rate-limit'
import { useServiceCtx } from '../../../utils/state'

function demoCookieSecure(event: Parameters<typeof getCookie>[0]): boolean {
  if (process.env.SITEBUILDER_INSECURE_COOKIES === '1') return false
  const proto = event.node.req.headers['x-forwarded-proto']
  const value = Array.isArray(proto) ? proto[0] : proto
  if (value?.split(',')[0]?.trim() === 'https') return true
  return (event.node.req.socket as { encrypted?: boolean }).encrypted === true
}

export default defineEventHandler((event) => {
  if (!demoMode()) {
    setResponseStatus(event, 404)
    return { error: { code: 'not_found', message: 'Not found.' } }
  }
  const sandbox = currentSandbox()
  if (!sandbox) {
    setResponseStatus(event, 503)
    return { error: { code: 'not_set_up', message: 'Demo golden snapshot is missing. Run npm run demo:golden.' } }
  }
  const ip = clientIp(event) ?? 'unknown'
  if (!hit(`demo-reset:sb:${sandbox.id}`, 5, 60 * 60_000) || !hit(`demo-reset:ip:${ip}`, 5, 60 * 60_000)) {
    setResponseStatus(event, 429)
    setResponseHeader(event, 'retry-after', 3600)
    return { error: { code: 'rate_limited', message: 'This demo was just reset. Wait a while and try again.' } }
  }
  const previous = getCookie(event, SESSION_COOKIE)
  const sessionSha256 = previous ? createHash('sha256').update(previous).digest('hex') : null
  let next
  try {
    next = resetDemoSandbox(sandbox.id, { clientIp: ip, sessionSha256 })
  } catch (error) {
    if (error instanceof AppError) {
      setResponseStatus(event, error.status)
      return error.toBody()
    }
    throw error
  }
  const { token, expiresAt } = runInSandbox(next, () => {
    const ctx = useServiceCtx()
    const user = ctx.db.select().from(users).where(and(eq(users.siteId, ctx.siteId), eq(users.email, DEMO_EMAIL))).get()
    if (!user) throw new AppError('not_set_up', 'Demo user is missing from this sandbox.')
    return createSession(ctx, user.id)
  })
  setCookie(event, SESSION_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: '/', expires: new Date(expiresAt) })
  const rawHost = event.node.req.headers.host
  const domain = cookieDomain(Array.isArray(rawHost) ? rawHost[0] : rawHost)
  setCookie(event, DEMO_COOKIE, next.id, {
    httpOnly: true,
    secure: demoCookieSecure(event),
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_IDLE_MS / 1000,
    ...(domain ? { domain } : {}),
  })
  return { ok: true, lastReset: next.meta.lastReset }
})
