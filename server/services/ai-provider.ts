// One OpenAI-compatible chat interface. OpenAI, xAI, Anthropic's compatibility API
// and local/custom servers all go through this. Tests inject a mock and never hit a network.
// See docs/12-ai-harness.md#bring-your-own-model.
import type { SiteSettings } from '../../shared/settings'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ChatTool {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ChatTool[]
  signal?: AbortSignal
}

export interface ChatUsage {
  tokensIn: number
  tokensOut: number
}

export interface ChatResult {
  message: ChatMessage
  usage: ChatUsage
}

export type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: ToolCall }

export interface ModelProvider {
  complete(req: ChatRequest): Promise<ChatResult>
  completeStream?(req: ChatRequest, onDelta: (delta: StreamDelta) => void): Promise<ChatResult>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export const PROVIDER_BASE_URLS: Record<Exclude<SiteSettings['ai']['provider'], 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  anthropic: 'https://api.anthropic.com/v1',
}

export function defaultBaseUrl(provider: SiteSettings['ai']['provider'], override: string | null): string | null {
  if (override) return override.replace(/\/+$/, '')
  if (provider === 'custom') return null
  return PROVIDER_BASE_URLS[provider]
}

type FetchFn = typeof fetch

export function openAiCompatibleProvider(opts: {
  baseUrl: string
  apiKey: string
  extraHeaders?: Record<string, string>
  fetch?: FetchFn
  timeoutMs?: number
}): ModelProvider {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const fetchFn = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 30_000

  async function complete(req: ChatRequest): Promise<ChatResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = req.signal
      ? AbortSignal.any([req.signal, controller.signal])
      : controller.signal
    try {
      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
          ...opts.extraHeaders,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map(toApiMessage),
          ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
          temperature: 0.3,
        }),
      })
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const err = raw.error as { message?: string } | undefined
        throw new ProviderError(err?.message || `The model provider returned ${res.status}.`, res.status)
      }
      return parseCompletion(raw)
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new ProviderError('The model provider timed out.')
      throw new ProviderError(error instanceof Error ? error.message : 'The model provider could not be reached.')
    } finally {
      clearTimeout(timer)
    }
  }

  return { complete }
}

function toApiMessage(m: ChatMessage): Record<string, unknown> {
  const body: Record<string, unknown> = { role: m.role, content: m.content }
  if (m.tool_call_id) body.tool_call_id = m.tool_call_id
  if (m.tool_calls?.length) {
    body.tool_calls = m.tool_calls.map((t) => ({
      id: t.id,
      type: 'function',
      function: { name: t.name, arguments: t.arguments },
    }))
  }
  return body
}

function parseCompletion(raw: Record<string, unknown>): ChatResult {
  const choices = raw.choices as Array<{ message?: Record<string, unknown> }> | undefined
  const msg = choices?.[0]?.message
  if (!msg) throw new ProviderError('The model provider sent an empty reply.')
  const usage = (raw.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number }
  const toolCallsRaw = msg.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined
  const tool_calls = toolCallsRaw?.map((t, i) => ({
    id: t.id || `call_${i}`,
    name: t.function?.name ?? '',
    arguments: t.function?.arguments ?? '{}',
  }))
  return {
    message: {
      role: 'assistant',
      content: typeof msg.content === 'string' ? msg.content : null,
      ...(tool_calls?.length ? { tool_calls } : {}),
    },
    usage: { tokensIn: Number(usage.prompt_tokens) || 0, tokensOut: Number(usage.completion_tokens) || 0 },
  }
}

export type MockTurn = ChatResult | ((req: ChatRequest) => ChatResult | Promise<ChatResult>)

/** Scripted provider for tests. Never touches the network. */
export function mockProvider(script: MockTurn[]): ModelProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  let i = 0
  return {
    calls,
    async complete(req) {
      calls.push(req)
      const turn = script[i]
      i++
      if (!turn) throw new ProviderError('The mock provider has no more scripted replies.')
      return typeof turn === 'function' ? await turn(req) : structuredClone(turn)
    },
  }
}

export function assistantText(text: string, usage: ChatUsage = { tokensIn: 10, tokensOut: 10 }): ChatResult {
  return { message: { role: 'assistant', content: text }, usage }
}

export function assistantTools(calls: { name: string; arguments: Record<string, unknown>; id?: string }[], text: string | null = null, usage: ChatUsage = { tokensIn: 10, tokensOut: 10 }): ChatResult {
  return {
    message: {
      role: 'assistant',
      content: text,
      tool_calls: calls.map((c, i) => ({ id: c.id ?? `call_${i + 1}`, name: c.name, arguments: JSON.stringify(c.arguments) })),
    },
    usage,
  }
}

export function extraHeadersFor(provider: SiteSettings['ai']['provider']): Record<string, string> | undefined {
  if (provider === 'anthropic') return { 'anthropic-version': '2023-06-01' }
  return undefined
}
