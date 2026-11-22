import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { collectAiTurn, MAX_STEPS, recordProviderFailure, requestAiCancel, resetAiCircuitBreaker, resolveAi, testAiConnection } from '../server/services/ai-loop'
import { startAiSession, monthCostMicros, addAiUsage, getAiSession, listAiMessages } from '../server/services/ai'
import { assistantText, assistantTools, mockProvider, ProviderError } from '../server/services/ai-provider'
import { createPage } from '../server/services/pages'
import { updateSettings } from '../server/services/settings'
import { sites } from '../server/db/schema'
import { penceToMicros } from '../shared/ai-pricing'
import { readSettings } from '../shared/settings'
import { setup } from './helpers'

function enableAi(ctx: ReturnType<typeof setup>['ctx'], patch: Record<string, unknown> = {}) {
  const current = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(current.settings)
  ctx.db.update(sites).set({ settings: { ...settings, ai: { ...settings.ai, enabled: true, ...patch } } }).where(eq(sites.id, ctx.siteId)).run()
}

afterEach(() => {
  resetAiCircuitBreaker()
})

describe('resolveAi', () => {
  it('is off by default, and ready once enabled with the mock provider env', () => {
    const s = setup()
    expect(resolveAi(s.ctx).reason).toBe('off')
    enableAi(s.ctx)
    const prev = process.env.SITEBUILDER_AI_PROVIDER
    process.env.SITEBUILDER_AI_PROVIDER = 'mock'
    expect(resolveAi(s.ctx).available).toBe(true)
    expect(resolveAi(s.ctx).reason).toBe('mock')
    process.env.SITEBUILDER_AI_PROVIDER = prev
    s.sqlite.close()
  })
})

describe('runAiTurn', () => {
  it('applies tool calls on the bound page and summarises them', async () => {
    const s = setup()
    enableAi(s.ctx)
    const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'campaign' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const provider = mockProvider([
      assistantTools([{ name: 'add_block', arguments: { block: { type: 'Quote', props: { text: 'They gave him a second chance.', attribution: 'A volunteer' } } } }], 'Adding a quote.'),
      assistantTools([
        { name: 'preview_screenshot', arguments: {} },
        { name: 'run_checks', arguments: {} },
      ]),
      assistantText('I added a quote and checked the page.'),
    ])
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Add a short volunteer quote.', { provider })
    expect(events.some((e) => e.type === 'tool_started' && e.tool === 'add_block')).toBe(true)
    expect(events.some((e) => e.type === 'tool_result' && e.tool === 'add_block' && e.ok)).toBe(true)
    const done = events.find((e) => e.type === 'finished')
    expect(done).toMatchObject({ type: 'finished', reason: 'done' })
    if (done?.type === 'finished') expect(done.message).toMatch(/quote/i)
    const latest = getAiSession(s.ctx, s.editor, session.id)
    expect(latest.tokensIn).toBeGreaterThan(0)
    expect(latest.costMicros).toBeGreaterThan(0)
    expect(latest.model).toBe('grok-4.7')
    expect(listAiMessages(s.ctx, session.id).some((m) => m.role === 'user')).toBe(true)
    s.sqlite.close()
  })

  it('refuses a tool call that leaves the bound page, and tells the model', async () => {
    const s = setup()
    enableAi(s.ctx)
    const a = createPage(s.ctx, s.editor, { title: 'A', template: 'standard' }).page
    const b = createPage(s.ctx, s.editor, { title: 'B', template: 'standard' }).page
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: a.id })
    const provider = mockProvider([
      assistantTools([{ name: 'add_block', arguments: { pageId: b.id, block: { type: 'Quote', props: { text: 'Nope' } } } }]),
      assistantText('I can only edit the page this session was opened for.'),
    ])
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Add a quote to the other page.', { provider })
    const result = events.find((e) => e.type === 'tool_result')
    expect(result).toMatchObject({ type: 'tool_result', ok: false })
    if (result?.type === 'tool_result') expect(result.error).toMatch(/one thing/)
    s.sqlite.close()
  })

  it('asks for a self-check after a change if the model tries to finish without one', async () => {
    const s = setup()
    enableAi(s.ctx)
    const { page } = createPage(s.ctx, s.editor, { title: 'Winter appeal', template: 'campaign' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const provider = mockProvider([
      assistantTools([{ name: 'add_block', arguments: { block: { type: 'Quote', props: { text: 'They gave him a second chance.' } } } }]),
      assistantText('All done.'),
      assistantTools([
        { name: 'preview_screenshot', arguments: { device: 'desktop' } },
        { name: 'run_checks', arguments: {} },
      ]),
      assistantText('Checked. The quote is on the page.'),
    ])
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Add a quote.', { provider })
    expect(provider.calls).toHaveLength(4)
    expect(provider.calls[2]!.messages.some((m) => m.role === 'user' && String(m.content).includes('preview_screenshot'))).toBe(true)
    expect(events.filter((e) => e.type === 'tool_started' && (e.tool === 'preview_screenshot' || e.tool === 'run_checks'))).toHaveLength(2)
    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'finished', reason: 'done' })
    s.sqlite.close()
  })

  it('stops at a session cost cap and at a monthly cap', async () => {
    const s = setup()
    enableAi(s.ctx, { sessionCapPence: 1, requestCapPence: 100, monthlyCapPence: 2000 })
    const { page } = createPage(s.ctx, s.editor, { title: 'Cap', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    addAiUsage(s.ctx, session.id, 0, 0, penceToMicros(1))
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Hello', { provider: mockProvider([assistantText('Hi')]) })
    expect(events.at(-1)).toMatchObject({ type: 'finished', reason: 'limit' })

    enableAi(s.ctx, { sessionCapPence: 200, monthlyCapPence: 1 })
    const page2 = createPage(s.ctx, s.editor, { title: 'Month', template: 'standard' }).page
    const session2 = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page2.id })
    addAiUsage(s.ctx, session2.id, 0, 0, penceToMicros(1))
    expect(monthCostMicros(s.ctx)).toBeGreaterThanOrEqual(penceToMicros(1))
    const monthly = await collectAiTurn(s.ctx, s.editor, session2.id, 'Hello', { provider: mockProvider([assistantText('Hi')]) })
    expect(monthly.at(-1)).toMatchObject({ type: 'finished', reason: 'monthly' })
    s.sqlite.close()
  })

  it('stops at the next step when cancel is requested', async () => {
    const s = setup()
    enableAi(s.ctx)
    const { page } = createPage(s.ctx, s.editor, { title: 'Stop', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const provider = mockProvider([
      (req) => {
        requestAiCancel(session.id)
        return assistantTools([{ name: 'get_page', arguments: {} }])
      },
      assistantText('should not run'),
    ])
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Look at the page', { provider })
    expect(events.at(-1)).toMatchObject({ type: 'finished', reason: 'stopped' })
    expect(provider.calls).toHaveLength(1)
    s.sqlite.close()
  })

  it('pauses after three provider failures in five minutes', async () => {
    const s = setup()
    enableAi(s.ctx)
    const now = s.clock.now().getTime()
    recordProviderFailure(now)
    recordProviderFailure(now + 1000)
    recordProviderFailure(now + 2000)
    const { page } = createPage(s.ctx, s.editor, { title: 'Down', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Hello', { provider: mockProvider([assistantText('Hi')]) })
    expect(events.at(-1)).toMatchObject({ type: 'finished', reason: 'unavailable' })
    s.sqlite.close()
  })

  it('records a provider error as unavailable, without throwing out of the loop', async () => {
    const s = setup()
    enableAi(s.ctx)
    const { page } = createPage(s.ctx, s.editor, { title: 'Err', template: 'standard' })
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const provider = mockProvider([() => Promise.reject(new ProviderError('connection reset'))])
    const events = await collectAiTurn(s.ctx, s.editor, session.id, 'Hello', { provider })
    expect(events.at(-1)).toMatchObject({ type: 'finished', reason: 'unavailable' })
    s.sqlite.close()
  })
})

describe('MAX_STEPS', () => {
  it('is the documented starting point', () => {
    expect(MAX_STEPS).toBe(25)
  })
})

describe('testAiConnection', () => {
  it('uses an injected mock and does not need the assistant to be switched on', async () => {
    const s = setup()
    const provider = mockProvider([assistantText('pong', { tokensIn: 2, tokensOut: 1 })])
    const result = await testAiConnection(s.ctx, { provider })
    expect(result).toMatchObject({ ok: true, model: 'grok-4.7', reply: 'pong', tokensIn: 2, tokensOut: 1 })
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.messages.at(-1)).toMatchObject({ role: 'user', content: 'ping' })
    s.sqlite.close()
  })

  it('asks for a key when none is stored and no mock is injected', async () => {
    const s = setup()
    await expect(testAiConnection(s.ctx)).rejects.toMatchObject({ code: 'ai_unavailable', message: /Add an API key first/ })
    s.sqlite.close()
  })
})
