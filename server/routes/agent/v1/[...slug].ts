// REST door of the agent gateway: /agent/v1/<operation>. See docs/agent-gateway.md and /agent/v1/openapi.json.
import { defineEventHandler, getRequestURL, setResponseHeader, setResponseStatus } from 'h3'
import { randomBytes } from 'node:crypto'
import { buildOpenApi } from '../../../services/agent/openapi'
import { AppError } from '../../../services/errors'
import { agentGatewayEnabled, agentHeaders, checkOrigin, errorStatus, gatewayOff, matchRoute, runRest, signIn } from '../../../utils/agent'
import { useServiceCtx } from '../../../utils/state'

const PREFIX = '/agent/v1'

export default defineEventHandler(async (event) => {
  if (!agentGatewayEnabled()) return gatewayOff(event)
  agentHeaders(event)
  const path = getRequestURL(event).pathname.replace(PREFIX, '').replace(/\/+$/, '') || '/'
  try {
    if (path === '/openapi.json' && event.method === 'GET') {
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return buildOpenApi()
    }
    checkOrigin(event)
    const ctx = useServiceCtx()
    const agent = signIn(event, ctx)
    const route = matchRoute(event.method, path)
    if (route === 'wrong-method') {
      setResponseHeader(event, 'allow', 'GET, POST')
      throw new AppError('validation_failed', `${event.method} is not how this address is used. Check the method in /agent/v1/openapi.json.`)
    }
    if (!route) throw new AppError('not_found', `There is no operation at ${path}. See /agent/v1/openapi.json.`)
    return await runRest(event, agent, ctx, route.op, route.params)
  } catch (error) {
    if (error instanceof AppError) {
      errorStatus(event, error)
      return error.toBody()
    }
    const ref = randomBytes(4).toString('hex')
    console.error(JSON.stringify({ level: 'error', ref, path: event.path, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }))
    setResponseStatus(event, 500)
    return { error: { code: 'internal', message: `Something went wrong. Reference: ${ref}`, ref } }
  }
})
