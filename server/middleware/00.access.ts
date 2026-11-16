// Check the Cloudflare Access token on every request when Access is configured (ADR 0007).
// Health checks are exempt so the container's own health probe works.
import { getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import { accessConfigFromEnv, createAccessVerifier } from '../services/access'

const config = accessConfigFromEnv(process.env)
const verify = config ? createAccessVerifier(config) : null
const EXEMPT = new Set(['/api/health', '/api/v1/health'])

export default defineEventHandler(async (event) => {
  if (!verify || EXEMPT.has(event.path.split('?')[0]!)) return
  const result = await verify(getRequestHeader(event, 'cf-access-jwt-assertion'))
  if (result.ok) {
    event.context.accessEmail = result.email
    return
  }
  console.warn(JSON.stringify({ level: 'warn', msg: 'access denied', reason: result.reason, path: event.path }))
  setResponseStatus(event, 403)
  if (event.path.startsWith('/api/')) return { error: { code: 'forbidden', message: 'Sign in through Cloudflare Access first.' } }
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return 'Sign in through Cloudflare Access first.'
})
