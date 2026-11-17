// One agent, one loop: plan, tools, observe, self-check, answer. Caps and a cancel flag stop it cleanly.
// See docs/12-ai-harness.md#agent-loop.
import { toolsFor } from '../../shared/ai-tasks'
import { costMicrosFor, penceToMicros } from '../../shared/ai-pricing'
import { readSettings, type SiteSettings } from '../../shared/settings'
import { sites } from '../db/schema'
import { eq } from 'drizzle-orm'
import { addAiUsage, appendAiMessage, cancelAiSession, endAiTurn, getAiSession, listAiMessages, monthCostMicros, runTool, type AiSession } from './ai'
import { buildTurnMessages, type ChatHistoryItem } from './ai-context'
import { extraHeadersFor, mockProvider, openAiCompatibleProvider, ProviderError, defaultBaseUrl, type ChatMessage, type ModelProvider } from './ai-provider'
import { chatToolsFor } from './ai-tools-schema'
import { getSecret, hasSecret, secretKeyFromEnv } from './auth'
import type { ActingAs, ServiceCtx } from './context'
import { AppError } from './errors'

export const MAX_STEPS = 25
const MUTATING = new Set(['add_block', 'update_props', 'move_block', 'remove_block', 'set_seo', 'set_meta', 'create_draft'])
const SELF_CHECK = new Set(['preview_screenshot', 'run_checks'])

export type AiEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_started'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'needs_you'; tool: string; result: unknown }
  | { type: 'finished'; reason: 'done' | 'limit' | 'monthly' | 'stopped' | 'unavailable' | 'off_remit'; message: string }
  | { type: 'error'; message: string }

export type AiLimitReason = 'request' | 'session' | 'monthly' | 'steps'

const cancelFlags = new Set<string>()
const recentFailures: number[] = []
let pausedUntil = 0

export function requestAiCancel(sessionId: string) {
  cancelFlags.add(sessionId)
}

export function clearAiCancel(sessionId: string) {
  cancelFlags.delete(sessionId)
}

export function resetAiCircuitBreaker() {
  recentFailures.length = 0
  pausedUntil = 0
}

export function recordProviderFailure(nowMs: number) {
  recentFailures.push(nowMs)
  const windowStart = nowMs - 5 * 60_000
  while (recentFailures.length && recentFailures[0]! < windowStart) recentFailures.shift()
  if (recentFailures.length >= 3) pausedUntil = nowMs + 2 * 60_000
}

export function providerPaused(nowMs: number): boolean {
  return nowMs < pausedUntil
}

export interface ResolvedAi {
  enabled: boolean
  available: boolean
  reason: 'off' | 'no_key' | 'paused' | 'monthly' | 'no_model' | 'ready' | 'mock'
  settings: SiteSettings['ai']
  baseUrl: string | null
  monthMicros: number
  monthCapMicros: number
}

export function resolveAi(ctx: ServiceCtx): ResolvedAi {
  const site = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const settings = readSettings(site?.settings).ai
  const monthMicros = monthCostMicros(ctx)
  const monthCapMicros = penceToMicros(settings.monthlyCapPence)
  const mock = process.env.SITEBUILDER_AI_PROVIDER === 'mock'
  const hasKey = mock || hasSecret(ctx, 'ai_api_key')
  const baseUrl = defaultBaseUrl(settings.provider, settings.baseUrl)
  let reason: ResolvedAi['reason'] = 'ready'
  if (!settings.enabled) reason = 'off'
  else if (providerPaused(ctx.now().getTime())) reason = 'paused'
  else if (monthCapMicros > 0 && monthMicros >= monthCapMicros) reason = 'monthly'
  else if (!settings.model) reason = 'no_model'
  else if (!mock && !hasKey) reason = 'no_key'
  else if (settings.provider === 'custom' && !baseUrl) reason = 'no_model'
  else if (mock) reason = 'mock'
  return {
    enabled: settings.enabled,
    available: reason === 'ready' || reason === 'mock',
    reason,
    settings,
    baseUrl,
    monthMicros,
    monthCapMicros,
  }
}

export function unavailableMessage(reason: ResolvedAi['reason']): string {
  switch (reason) {
    case 'off':
      return "The assistant isn't switched on yet. You can still edit the page yourself."
    case 'monthly':
      return "This month's assistant budget is used up. You can still edit by hand."
    case 'paused':
    case 'no_key':
    case 'no_model':
    default:
      return "The assistant isn't available right now. Everything else works as normal."
  }
}

export function resolveProvider(ctx: ServiceCtx, resolved: ResolvedAi, injected?: ModelProvider): ModelProvider {
  if (injected) return injected
  if (ctx.aiProvider) return ctx.aiProvider
  if (process.env.SITEBUILDER_AI_PROVIDER === 'mock') {
    return mockProvider([{ message: { role: 'assistant', content: 'This is the mock assistant. I can only give scripted replies in tests.' }, usage: { tokensIn: 1, tokensOut: 1 } }])
  }
  const baseUrl = resolved.baseUrl
  if (!baseUrl) throw new AppError('ai_unavailable', unavailableMessage('no_model'))
  let key: string | null = null
  try {
    key = getSecret(ctx, secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY), 'ai_api_key')
  } catch {
    key = null
  }
  if (!key) throw new AppError('ai_unavailable', unavailableMessage('no_key'))
  return openAiCompatibleProvider({
    baseUrl,
    apiKey: key,
    extraHeaders: extraHeadersFor(resolved.settings.provider),
  })
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return { _parseError: 'Arguments were not valid JSON.' }
  }
}

function historyFromStore(rows: { role: string; content: Record<string, unknown> }[]): ChatHistoryItem[] {
  const out: ChatHistoryItem[] = []
  for (const row of rows) {
    if (row.role === 'user' && typeof row.content.text === 'string') out.push({ role: 'user', content: row.content.text })
    else if (row.role === 'assistant') {
      const calls = Array.isArray(row.content.tool_calls) ? (row.content.tool_calls as ChatHistoryItem['tool_calls']) : undefined
      out.push({ role: 'assistant', content: typeof row.content.text === 'string' ? row.content.text : null, ...(calls?.length ? { tool_calls: calls } : {}) })
    } else if (row.role === 'tool' && typeof row.content.tool_call_id === 'string') {
      out.push({ role: 'tool', content: typeof row.content.text === 'string' ? row.content.text : JSON.stringify(row.content), tool_call_id: row.content.tool_call_id })
    }
  }
  return out
}

export async function* runAiTurn(
  ctx: ServiceCtx,
  actor: ActingAs,
  sessionId: string,
  userText: string,
  opts: { provider?: ModelProvider } = {},
): AsyncGenerator<AiEvent> {
  clearAiCancel(sessionId)
  const session = getAiSession(ctx, actor, sessionId)
  if (session.state !== 'active') {
    yield { type: 'finished', reason: 'stopped', message: 'This assistant session has ended.' }
    return
  }
  const resolved = resolveAi(ctx)
  const injected = opts.provider ?? ctx.aiProvider
  if (!resolved.enabled) {
    yield { type: 'finished', reason: 'unavailable', message: unavailableMessage('off') }
    return
  }
  if (resolved.reason === 'monthly') {
    yield { type: 'finished', reason: 'monthly', message: unavailableMessage('monthly') }
    return
  }
  if (resolved.reason === 'paused') {
    yield { type: 'finished', reason: 'unavailable', message: unavailableMessage('paused') }
    return
  }
  if (!injected && !resolved.available) {
    yield { type: 'finished', reason: 'unavailable', message: unavailableMessage(resolved.reason) }
    return
  }

  const sessionCap = penceToMicros(resolved.settings.sessionCapPence)
  const requestCap = penceToMicros(resolved.settings.requestCapPence)
  if (resolved.monthCapMicros > 0 && resolved.monthMicros >= resolved.monthCapMicros) {
    yield { type: 'finished', reason: 'monthly', message: unavailableMessage('monthly') }
    return
  }
  if (sessionCap > 0 && session.costMicros >= sessionCap) {
    yield { type: 'finished', reason: 'limit', message: "That's as far as I can go in this session. Here's what I'd done so far. You can still edit by hand." }
    return
  }

  appendAiMessage(ctx, session.id, 'user', { text: userText })
  const provider = resolveProvider(ctx, resolved, opts.provider)
  const tools = chatToolsFor(toolsFor(actor.role, session.taskType))
  const messages: ChatMessage[] = buildTurnMessages(ctx, actor, session, historyFromStore(listAiMessages(ctx, session.id).slice(0, -1)), userText)

  let steps = 0
  let turnMicros = 0
  let mutated = false
  let checked = new Set<string>()
  let forcedCheck = false
  const model = resolved.settings.model
  const asAi: ActingAs = { ...actor, aiSessionId: session.id }

  const hitLimit = (why: AiLimitReason): AiEvent => {
    const message =
      why === 'monthly'
        ? unavailableMessage('monthly')
        : why === 'steps'
          ? "That's as far as I can go in one go. Here's what's left. You can still edit by hand."
          : "That's as far as I can go in one go. Here's what I'd done so far. You can still edit by hand."
    return { type: 'finished', reason: why === 'monthly' ? 'monthly' : 'limit', message }
  }

  try {
    while (steps < MAX_STEPS) {
      if (cancelFlags.has(sessionId)) {
        clearAiCancel(sessionId)
        endAiTurn(ctx, asAi, session.id)
        yield { type: 'finished', reason: 'stopped', message: "Stopped. Here's what I'd done so far." }
        return
      }
      if (requestCap > 0 && turnMicros >= requestCap) {
        endAiTurn(ctx, asAi, session.id)
        yield hitLimit('request')
        return
      }
      const latest = getAiSession(ctx, actor, sessionId)
      if (sessionCap > 0 && latest.costMicros >= sessionCap) {
        endAiTurn(ctx, asAi, session.id)
        yield hitLimit('session')
        return
      }
      if (resolved.monthCapMicros > 0 && monthCostMicros(ctx) >= resolved.monthCapMicros) {
        endAiTurn(ctx, asAi, session.id)
        yield hitLimit('monthly')
        return
      }

      let result
      try {
        result = await provider.complete({ model, messages, tools })
      } catch (error) {
        recordProviderFailure(ctx.now().getTime())
        const message = error instanceof ProviderError ? error.message : "The assistant isn't available right now. Everything else works as normal."
        yield { type: 'finished', reason: 'unavailable', message: /timeout|reach|provider/i.test(message) ? "The assistant isn't available right now. Everything else works as normal." : message }
        return
      }

      const usage = result.usage
      const cost = costMicrosFor(model, usage.tokensIn, usage.tokensOut)
      addAiUsage(ctx, session.id, usage.tokensIn, usage.tokensOut, cost, model)
      turnMicros += cost

      const reply = result.message
      messages.push(reply)

      const calls = reply.tool_calls ?? []
      if (!calls.length) {
        if (mutated && !forcedCheck && (checked.size < 2)) {
          forcedCheck = true
          messages.push({
            role: 'user',
            content: 'You changed the draft in this turn but have not yet called both preview_screenshot and run_checks. Call them now, fix any problems you can, then reply to the person.',
          })
          continue
        }
        const text = (reply.content ?? '').trim() || 'Done.'
        appendAiMessage(ctx, session.id, 'assistant', { text })
        endAiTurn(ctx, asAi, session.id)
        yield { type: 'text', text }
        yield { type: 'finished', reason: 'done', message: text }
        return
      }

      appendAiMessage(ctx, session.id, 'assistant', { text: reply.content, tool_calls: calls })
      if (reply.content?.trim()) yield { type: 'text', text: reply.content }

      for (const call of calls) {
        steps++
        if (steps > MAX_STEPS) {
          endAiTurn(ctx, asAi, session.id)
          yield hitLimit('steps')
          return
        }
        if (cancelFlags.has(sessionId)) {
          clearAiCancel(sessionId)
          endAiTurn(ctx, asAi, session.id)
          yield { type: 'finished', reason: 'stopped', message: "Stopped. Here's what I'd done so far." }
          return
        }
        const args = call.arguments.includes('_parseError') ? parseArgs(call.arguments) : parseArgs(call.arguments)
        yield { type: 'tool_started', tool: call.name, args }
        const toolResult = await runTool(ctx, actor, session.id, call.name, args)
        appendAiMessage(ctx, session.id, 'tool', { tool: call.name, tool_call_id: call.id, ok: toolResult.ok, text: JSON.stringify(toolResult), ...(toolResult.ok ? { result: toolResult.result } : { error: toolResult.error }) })
        messages.push({ role: 'tool', content: JSON.stringify(toolResult), tool_call_id: call.id })
        yield { type: 'tool_result', tool: call.name, ok: toolResult.ok, result: toolResult.ok ? toolResult.result : undefined, error: toolResult.ok ? undefined : toolResult.error }
        if (toolResult.ok && MUTATING.has(call.name)) mutated = true
        if (toolResult.ok && SELF_CHECK.has(call.name)) checked.add(call.name)
        if (toolResult.ok && toolResult.result && typeof toolResult.result === 'object' && 'needsYou' in (toolResult.result as object)) {
          yield { type: 'needs_you', tool: call.name, result: toolResult.result }
        }
      }
    }
    endAiTurn(ctx, asAi, session.id)
    yield hitLimit('steps')
  } finally {
    clearAiCancel(sessionId)
  }
}

export async function collectAiTurn(
  ctx: ServiceCtx,
  actor: ActingAs,
  sessionId: string,
  userText: string,
  opts: { provider?: ModelProvider } = {},
): Promise<AiEvent[]> {
  const events: AiEvent[] = []
  for await (const event of runAiTurn(ctx, actor, sessionId, userText, opts)) events.push(event)
  return events
}

/** A one-shot ping used by Settings > AI. Does not start a session or count against caps. */
export async function testAiConnection(ctx: ServiceCtx, opts: { provider?: ModelProvider } = {}): Promise<{
  ok: true
  model: string
  reply: string
  tokensIn: number
  tokensOut: number
}> {
  const resolved = resolveAi(ctx)
  const injected = opts.provider ?? ctx.aiProvider
  if (resolved.settings.provider === 'custom' && !resolved.baseUrl && !injected) {
    throw new AppError('ai_unavailable', 'Add a base URL for your custom provider, then try the test again.')
  }
  if (!resolved.settings.model) {
    throw new AppError('ai_unavailable', 'Choose a model, then try the test again.')
  }
  if (!injected && process.env.SITEBUILDER_AI_PROVIDER !== 'mock' && !hasSecret(ctx, 'ai_api_key')) {
    throw new AppError('ai_unavailable', 'Add an API key first, then try the test again.')
  }
  const provider = resolveProvider(ctx, resolved, injected)
  try {
    const result = await provider.complete({
      model: resolved.settings.model,
      messages: [
        { role: 'system', content: 'You are a connection test. Reply with the single word pong.' },
        { role: 'user', content: 'ping' },
      ],
    })
    const reply = (result.message.content ?? '').trim()
    if (!reply) throw new ProviderError('The model provider sent an empty reply.')
    return {
      ok: true,
      model: resolved.settings.model,
      reply: reply.slice(0, 240),
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
    }
  } catch (error) {
    recordProviderFailure(ctx.now().getTime())
    if (error instanceof AppError) throw error
    const message = error instanceof ProviderError ? error.message : "The assistant isn't available right now. Everything else works as normal."
    throw new AppError('ai_unavailable', /timeout|reach|provider/i.test(message) ? "The assistant isn't available right now. Everything else works as normal." : message)
  }
}
