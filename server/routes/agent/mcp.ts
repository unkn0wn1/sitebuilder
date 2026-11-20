// MCP door of the agent gateway: /agent/mcp, streamable HTTP, stateless, JSON replies. Same tools as REST.
import { defineEventHandler, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { randomBytes } from 'node:crypto'
import { handleRpc, parseRpc, type RpcReply } from '../../services/agent/mcp'
import { AppError } from '../../services/errors'
import { agentGatewayEnabled, agentHeaders, checkOrigin, errorStatus, gatewayOff, signIn } from '../../utils/agent'
import { useServiceCtx } from '../../utils/state'

export default defineEventHandler(async (event) => {
  if (!agentGatewayEnabled()) return gatewayOff(event)
  agentHeaders(event)
  if (event.method !== 'POST') {
    // No server-initiated stream and no sessions: every call is one POST (MCP streamable HTTP, stateless).
    setResponseHeader(event, 'allow', 'POST')
    setResponseStatus(event, 405)
    return { error: { code: 'validation_failed', message: 'Send MCP messages with POST. This server has no stream and no sessions.' } }
  }
  try {
    checkOrigin(event)
    const ctx = useServiceCtx()
    const agent = signIn(event, ctx)
    const body = await readBody(event).catch(() => undefined)
    if (body === undefined) {
      setResponseStatus(event, 400)
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'The body must be JSON.' } }
    }
    const parsed = parseRpc(body)
    if ('error' in parsed) {
      setResponseStatus(event, 400)
      return parsed.error
    }
    const replies: RpcReply[] = []
    for (const m of parsed.messages) {
      try {
        const r = handleRpc(ctx, agent, m)
        if (r) replies.push(r)
      } catch (error) {
        const ref = randomBytes(4).toString('hex')
        console.error(JSON.stringify({ level: 'error', ref, path: event.path, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }))
        replies.push({ jsonrpc: '2.0', id: m.id ?? null, error: { code: -32603, message: `Something went wrong. Reference: ${ref}` } })
      }
    }
    if (!replies.length) {
      setResponseStatus(event, 202)
      return ''
    }
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return parsed.batch ? replies : replies[0]
  } catch (error) {
    if (error instanceof AppError) {
      errorStatus(event, error)
      return error.toBody()
    }
    throw error
  }
})
