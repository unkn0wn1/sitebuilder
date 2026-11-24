// For /api/v1: CSRF origin check on writes, then resolve the session cookie to an actor.
// See docs/14-api.md#conventions and docs/15-security.md#the-builder.
import { getCookie, getRequestHeader, getRequestURL, setResponseStatus } from 'h3'
import { getSessionUser } from '../services/auth'
import { AppError } from '../services/errors'
import { SESSION_COOKIE } from '../utils/api'
import { useServiceCtx } from '../utils/state'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/v1/')) return
  if (!SAFE.has(event.method)) {
    const expected = process.env.SITEBUILDER_ORIGIN ?? getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
    if (getRequestHeader(event, 'origin') !== expected) {
      setResponseStatus(event, 403)
      return new AppError('csrf', 'This request did not come from the builder. Reload the page and try again.').toBody()
    }
  }
  // No cookie means no actor. Skip the database so liveness routes stay up in demo mode,
  // where a sandbox is deliberately not opened for /api/v1/health.
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return
  try {
    const user = getSessionUser(useServiceCtx(), token)
    if (user) event.context.actor = { id: user.id, role: user.role, isOperator: user.isOperator }
  } catch (error) {
    if (error instanceof AppError) {
      setResponseStatus(event, error.status)
      return error.toBody()
    }
    throw error
  }
})
