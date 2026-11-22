// HTTP plumbing for the agent gateway: is it on, who is calling, and which operation does a request mean.
// The gateway never reads cookies and never accepts a browser session (ADR 0018).
import { getQuery, getRequestHeader, getRequestIP, readBody, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import type { ServiceCtx } from '../services/context'
import { AppError } from '../services/errors'
import { authenticateAgent, type SignedInAgent } from '../services/agent/tokens'
import { OPERATIONS, callOperation, type Operation } from '../services/agent/operations'
import { hit } from './rate-limit'

export const agentGatewayEnabled = () => process.env.SITEBUILDER_AGENT_GATEWAY === '1'

export function clientIp(event: H3Event): string | null {
  return getRequestHeader(event, 'cf-connecting-ip') ?? getRequestIP(event, { xForwardedFor: true }) ?? null
}

export function bearerToken(event: H3Event): string | null {
  const h = getRequestHeader(event, 'authorization')
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h ?? '')
  return m ? m[1]! : null
}

export function agentHeaders(event: H3Event) {
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
}

export function gatewayOff(event: H3Event) {
  agentHeaders(event)
  setResponseStatus(event, 404)
  return { error: { code: 'not_found', message: 'The agent gateway is not switched on for this site.' } }
}

/** Reject a browser page calling this API from an origin that is not on SITEBUILDER_AGENT_ALLOWED_ORIGINS (if that is set). */
export function checkOrigin(event: H3Event) {
  const allowed = (process.env.SITEBUILDER_AGENT_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const origin = getRequestHeader(event, 'origin')
  if (allowed.length && origin && !allowed.includes(origin)) throw new AppError('forbidden', 'This origin may not call the agent gateway.')
}

/** Resolve the bearer token. Failed attempts are rate limited per address so a token cannot be guessed. */
export function signIn(event: H3Event, ctx: ServiceCtx): SignedInAgent {
  const ip = clientIp(event)
  try {
    return authenticateAgent(ctx, bearerToken(event), ip)
  } catch (error) {
    if (error instanceof AppError && error.code === 'unauthenticated') {
      setResponseHeader(event, 'www-authenticate', 'Bearer realm="sitebuilder-agent"')
      if (!hit(`agent-auth:${ip ?? 'unknown'}`, 20, 60_000)) throw new AppError('rate_limited', 'Too many failed attempts from this address. Wait a minute.', undefined, { retryAfterSeconds: 60 })
    }
    throw error
  }
}

export function errorStatus(event: H3Event, error: AppError) {
  setResponseStatus(event, error.status)
  const retry = (error.extra as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds
  if (retry) setResponseHeader(event, 'retry-after', retry)
}

// ---------------------------------------------------------------------------------------------------------------------
// REST routing

interface Route {
  op: Operation
  re: RegExp
  params: string[]
}

const ROUTES: Route[] = OPERATIONS.map((op) => {
  const params: string[] = []
  const src = op.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    params.push(name)
    return '([^/]+)'
  })
  return { op, re: new RegExp(`^${src}$`), params }
})

export function matchRoute(method: string, path: string): { op: Operation; params: Record<string, string> } | 'wrong-method' | null {
  let other = false
  for (const r of ROUTES) {
    const m = r.re.exec(path)
    if (!m) continue
    if (r.op.method !== method) {
      other = true
      continue
    }
    return { op: r.op, params: Object.fromEntries(r.params.map((p, i) => [p, decodeURIComponent(m[i + 1]!)])) }
  }
  return other ? 'wrong-method' : null
}

export async function runRest(event: H3Event, agent: SignedInAgent, ctx: ServiceCtx, op: Operation, params: Record<string, string>) {
  let input: Record<string, unknown>
  if (op.method === 'GET') input = { ...getQuery(event) }
  else {
    const body = await readBody(event).catch(() => {
      throw new AppError('validation_failed', 'The body must be JSON.', [{ path: '(body)', message: 'Not valid JSON.' }])
    })
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) throw new AppError('validation_failed', 'The body must be a JSON object.', [{ path: '(body)', message: 'Not an object.' }])
    input = { ...((body as Record<string, unknown> | undefined) ?? {}) }
  }
  Object.assign(input, params)
  return callOperation(ctx, agent, op.name, input)
}
