// A small MCP server (streamable HTTP, stateless, JSON responses only) over the operation table.
// Spec: modelcontextprotocol.io, revision 2025-06-18. Handles initialize, ping, tools, resources and prompts.
// The HTTP route does authentication; this file turns one JSON-RPC message into one reply.
import type { ServiceCtx } from '../context'
import { AppError } from '../errors'
import { getSite } from './gateway'
import { strippedSoul } from '../soul'
import { PROMPTS, RESOURCES, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_TITLE } from './mcp-docs'
import { ERROR_CATALOG, OPERATIONS, callOperation, inputJsonSchema, operationAnnotations, toolDescription } from './operations'
import type { SignedInAgent } from './tokens'

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const SERVER_VERSION = '1.0.0'

type Id = string | number | null
export interface RpcRequest {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}
export type RpcReply = { jsonrpc: '2.0'; id: Id; result: unknown } | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string; data?: unknown } }

const ok = (id: Id, result: unknown): RpcReply => ({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string, data?: unknown): RpcReply => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } })

export function toolList() {
  return OPERATIONS.map((o) => ({
    name: o.name,
    title: o.doc.summary,
    description: toolDescription(o),
    inputSchema: inputJsonSchema(o),
    annotations: operationAnnotations(o),
  }))
}

/** What a failed tool call looks like to the model: the code, the message, and what to do about it. */
export function errorText(error: AppError): string {
  const doc = ERROR_CATALOG.find((e) => e.code === error.code)
  const lines = [`ERROR ${error.code}: ${error.message}`]
  if (doc) lines.push(`What to do: ${doc.recovery}`)
  const body = error.toBody().error as Record<string, unknown>
  const { code: _c, message: _m, ...rest } = body
  if (Object.keys(rest).length) lines.push(`Details: ${JSON.stringify(rest)}`)
  return lines.join('\n')
}

function toolBody(result: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false as const }
}

function toolResult(ctx: ServiceCtx, agent: SignedInAgent, params: Record<string, unknown>) {
  const name = typeof params.name === 'string' ? params.name : ''
  try {
    const result = callOperation(ctx, agent, name, params.arguments ?? {})
    if (result instanceof Promise) {
      return result.then(toolBody, (error: unknown) => {
        if (error instanceof AppError) return { content: [{ type: 'text', text: errorText(error) }], structuredContent: error.toBody(), isError: true as const }
        throw error
      })
    }
    return toolBody(result)
  } catch (error) {
    if (error instanceof AppError) return { content: [{ type: 'text', text: errorText(error) }], structuredContent: error.toBody(), isError: true as const }
    throw error
  }
}

/** Handle one JSON-RPC message. Returns null for notifications (the HTTP layer answers 202). */
export function handleRpc(ctx: ServiceCtx, agent: SignedInAgent, msg: RpcRequest): RpcReply | Promise<RpcReply> | null {
  const id = msg.id ?? null
  const isNotification = msg.id === undefined
  const params = msg.params ?? {}
  if (isNotification) return null
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const version = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSIONS[0]
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: toolList() })
    case 'tools/call': {
      const produced = toolResult(ctx, agent, params)
      if (produced instanceof Promise) return produced.then((value) => ok(id, value))
      return ok(id, produced)
    }
    case 'resources/list':
      return ok(id, { resources: [{ uri: 'sitebuilder://you', name: 'you', title: 'Your permissions right now', description: 'Live: what this token may do, its rules and rate limits. The same as get_site.', mimeType: 'application/json' }, { uri: 'sitebuilder://soul', name: 'soul', title: 'Site personality', description: 'The site tone of voice, with comments removed. Read-only. To propose a new one, use update_soul. A person must approve it. It does not change what this token may do.', mimeType: 'text/markdown' }, ...RESOURCES.map(({ uri, name, title, description, mimeType }) => ({ uri, name, title, description, mimeType }))] })
    case 'resources/templates/list':
      return ok(id, { resourceTemplates: [] })
    case 'resources/read': {
      const uri = typeof params.uri === 'string' ? params.uri : ''
      if (uri === 'sitebuilder://you') return ok(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(getSite(ctx, agent), null, 2) }] })
      if (uri === 'sitebuilder://soul') return ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: strippedSoul(ctx) }] })
      const res = RESOURCES.find((r) => r.uri === uri)
      if (!res) return fail(id, -32002, `No resource ${uri}. Use resources/list.`, { uri })
      return ok(id, { contents: [{ uri, mimeType: res.mimeType, text: res.text() }] })
    }
    case 'prompts/list':
      return ok(id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) })
    case 'prompts/get': {
      const prompt = PROMPTS.find((p) => p.name === params.name)
      if (!prompt) return fail(id, -32602, `No prompt ${String(params.name)}. Use prompts/list.`)
      const args = Object.fromEntries(Object.entries((params.arguments ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      const missing = prompt.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name)
      if (missing.length) return fail(id, -32602, `Missing arguments: ${missing.join(', ')}.`)
      return ok(id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }] })
    }
    case 'logging/setLevel':
      return ok(id, {})
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`)
  }
}

/** Parse a POST body (one message or a batch) into messages. Returns an error reply if it is not JSON-RPC. */
export function parseRpc(body: unknown): { messages: RpcRequest[]; batch: boolean } | { error: RpcReply } {
  const list = Array.isArray(body) ? body : [body]
  if (!list.length) return { error: fail(null, -32600, 'Empty batch.') }
  const messages: RpcRequest[] = []
  for (const m of list) {
    if (!m || typeof m !== 'object' || (m as RpcRequest).jsonrpc !== '2.0' || typeof (m as RpcRequest).method !== 'string') {
      // A reply or response message from the client: nothing to do, accepted silently.
      if (m && typeof m === 'object' && ('result' in m || 'error' in m)) continue
      return { error: fail(null, -32600, 'Not a JSON-RPC 2.0 request.') }
    }
    messages.push(m as RpcRequest)
  }
  return { messages, batch: Array.isArray(body) }
}
