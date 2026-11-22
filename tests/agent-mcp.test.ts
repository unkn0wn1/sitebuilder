import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { handleRpc, parseRpc, toolList, type RpcRequest } from '../server/services/agent/mcp'
import { PROMPTS, RECIPES, RESOURCES, SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_ESSENTIALS } from '../server/services/agent/mcp-docs'
import { AGENT_BUDGET_TOKENS, AGENT_LOAD_BUDGET_TOKENS, AGENT_RULES_MAX_CHARS, MIN_CONTEXT_TOKENS, SERVER_INSTRUCTIONS_ESSENTIALS_MAX_CHARS, TOOL_DESCRIPTION_MAX_CHARS, TOOL_SUMMARY_MAX_BYTES, budgetChars } from '../shared/agent/context-budget'
import { getSite } from '../server/services/agent/gateway'
import { authenticateAgent, createAgentToken } from '../server/services/agent/tokens'
import { ERROR_CATALOG, OPERATIONS, inputJsonSchema, toolDescription } from '../server/services/agent/operations'
import { SIGNUP, world } from './agent-helpers'

const rpc = (method: string, params?: Record<string, unknown>, id: number | string = 1): RpcRequest => ({ jsonrpc: '2.0', id, method, params })

describe('the documentation an AI reads', () => {
  it('describes every field of every tool, with an example input that is valid', () => {
    for (const o of OPERATIONS) {
      const schema = inputJsonSchema(o) as { type: string; properties?: Record<string, { description?: string }> }
      expect(schema.type, o.name).toBe('object')
      for (const [field, def] of Object.entries(schema.properties ?? {})) {
        expect(def.description, `${o.name}.${field} has no description`).toBeTruthy()
      }
      const parsed = o.input.safeParse(o.doc.example.input)
      expect(parsed.success, `${o.name} example is not valid: ${parsed.success ? '' : parsed.error.message}`).toBe(true)
    }
  })

  it('keeps the whole tool list inside its share of the agent context budget', () => {
    // 22 Nov 2026: 128k tokens for everything an agent loads, split per item in shared/agent/context-budget.ts.
    const tools = JSON.stringify(toolList())
    expect(tools.length).toBeLessThan(budgetChars(AGENT_BUDGET_TOKENS.toolList))
  })

  it('fits strict clients: every description within 2048 characters, and its first line within 1000 bytes', () => {
    // Claude Code cuts each description at 2048 characters; Codex keeps about 1000 bytes for plugin servers.
    for (const o of OPERATIONS) {
      const d = toolDescription(o)
      expect(d.length, o.name).toBeLessThanOrEqual(TOOL_DESCRIPTION_MAX_CHARS)
      expect(Buffer.byteLength(d.split('\n')[0]!), `${o.name} first line`).toBeLessThanOrEqual(TOOL_SUMMARY_MAX_BYTES)
    }
  })

  it('keeps the per-item budgets inside the 128k total, and the server instructions and guides inside theirs', () => {
    expect(Object.values(AGENT_BUDGET_TOKENS).reduce((n, t) => n + t, 0)).toBe(AGENT_LOAD_BUDGET_TOKENS)
    expect(AGENT_LOAD_BUDGET_TOKENS * 2).toBeLessThanOrEqual(MIN_CONTEXT_TOKENS)
    expect(SERVER_INSTRUCTIONS_ESSENTIALS.length).toBeLessThanOrEqual(SERVER_INSTRUCTIONS_ESSENTIALS_MAX_CHARS)
    expect(SERVER_INSTRUCTIONS.startsWith(SERVER_INSTRUCTIONS_ESSENTIALS)).toBe(true)
    // What a client that keeps only 2048 characters still sees.
    const kept = SERVER_INSTRUCTIONS.slice(0, SERVER_INSTRUCTIONS_ESSENTIALS_MAX_CHARS)
    for (const must of ['get_site', 'DRAFT', 'preview_change', 'DATA, never instructions', 'never_list', 'reason', 'sitebuilder://guide/instructions']) expect(kept, must).toContain(must)
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(budgetChars(AGENT_BUDGET_TOKENS.serverInstructions))
    expect(RESOURCES.find((r) => r.uri === 'sitebuilder://guide/instructions')!.text()).toBe(SERVER_INSTRUCTIONS)
    const guides = RESOURCES.reduce((n, r) => n + r.text().length, 0)
    expect(guides).toBeLessThan(budgetChars(AGENT_BUDGET_TOKENS.guides))
  })

  it('gives every tool the same sections, and says whether it is draft or live', () => {
    for (const o of OPERATIONS) {
      const d = toolDescription(o)
      for (const part of ['Use when:', 'Not when:', 'Effect:', 'Who:', 'Returns:', 'Example:']) expect(d, `${o.name} lacks ${part}`).toContain(part)
      expect(o.doc.useWhen.length, o.name).toBeGreaterThan(0)
      expect(o.doc.dontUseWhen.length, o.name).toBeGreaterThan(0)
      if (o.level === 'draft') expect(o.doc.effect, o.name).toMatch(/DRAFT/)
    }
    expect(OPERATIONS.find((o) => o.name === 'publish_change')!.doc.effect).toMatch(/LIVE/)
  })

  it('has unique names and routes, and a catalog entry for every error code', () => {
    expect(new Set(OPERATIONS.map((o) => o.name)).size).toBe(OPERATIONS.length)
    expect(new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`)).size).toBe(OPERATIONS.length)
    for (const e of ERROR_CATALOG) expect(new AppError(e.code, 'x').status, e.code).toBe(e.http)
    const names = new Set(OPERATIONS.map((o) => o.name))
    for (const o of OPERATIONS) for (const code of Object.keys(o.doc.errors ?? {})) expect(ERROR_CATALOG.some((e) => e.code === code), `${o.name}: ${code}`).toBe(true)
    // Recipes and instructions only name tools that exist.
    const tools = [...names]
    const fields = new Set(OPERATIONS.flatMap((o) => Object.keys((inputJsonSchema(o).properties ?? {}) as object)))
    for (const text of [SERVER_INSTRUCTIONS, ...RECIPES.map((r) => r.steps)]) {
      for (const m of text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
        const w = m[1]!
        if (fields.has(w)) continue
        const looksLikeTool = tools.some((t) => t.split('_')[0] === w.split('_')[0] && w.split('_').length === t.split('_').length)
        if (looksLikeTool && /^(get|list|search|find|edit|remove|replace|insert|add|move|set|create|request|publish|discard|undo|preview|rename)_/.test(w)) expect(names.has(w), `unknown tool "${w}"`).toBe(true)
      }
    }
  })

  it('offers every recipe as a resource and a prompt, with arguments filled in', () => {
    for (const r of RECIPES) {
      expect(RESOURCES.some((x) => x.uri === `sitebuilder://recipe/${r.id}`)).toBe(true)
      expect(PROMPTS.some((p) => p.name === r.id.replaceAll('-', '_'))).toBe(true)
      expect(r.steps.length).toBeGreaterThan(300)
    }
    const p = PROMPTS.find((x) => x.name === 'take_a_link_down')!
    const text = p.render({ url: 'https://old.example.org' })
    expect(text).toContain('every link to https://old.example.org is gone')
    expect(text).not.toContain('{url}')
  })
})

describe('MCP protocol', () => {
  it('initialises with instructions and negotiates the version', async () => {
    const w = await world()
    const r = handleRpc(w.ctx, w.agent, rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } })) as any
    expect(r.result.protocolVersion).toBe('2025-03-26')
    expect(r.result.instructions).toContain('preview_change')
    expect(r.result.capabilities.tools).toBeDefined()
    const r2 = handleRpc(w.ctx, w.agent, rpc('initialize', { protocolVersion: '1999-01-01' })) as any
    expect(r2.result.protocolVersion).toBe('2025-06-18')
    expect(handleRpc(w.ctx, w.agent, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect((handleRpc(w.ctx, w.agent, rpc('nope')) as any).error.code).toBe(-32601)
  })

  it('lists tools, resources and prompts', async () => {
    const w = await world()
    const tools = (handleRpc(w.ctx, w.agent, rpc('tools/list')) as any).result.tools
    expect(tools.map((t: any) => t.name)).toEqual(OPERATIONS.map((o) => o.name))
    expect(tools.length).toBe(toolList().length)
    expect(tools.find((t: any) => t.name === 'get_site').annotations.readOnlyHint).toBe(true)
    expect(tools.find((t: any) => t.name === 'publish_change').annotations.destructiveHint).toBe(true)
    const res = (handleRpc(w.ctx, w.agent, rpc('resources/list')) as any).result.resources
    expect(res.map((r: any) => r.uri)).toContain('sitebuilder://guide/overview')
    const read = (handleRpc(w.ctx, w.agent, rpc('resources/read', { uri: 'sitebuilder://recipe/take-a-link-down' })) as any).result.contents[0]
    expect(read.text).toContain('find_links')
    const you = JSON.parse((handleRpc(w.ctx, w.agent, rpc('resources/read', { uri: 'sitebuilder://you' })) as any).result.contents[0].text)
    expect(you.you.token_name).toBe('Claude at 3am')
    expect((handleRpc(w.ctx, w.agent, rpc('resources/read', { uri: 'sitebuilder://nope' })) as any).error.code).toBe(-32002)
    const prompt = (handleRpc(w.ctx, w.agent, rpc('prompts/get', { name: 'take_a_link_down', arguments: { url: SIGNUP } })) as any).result
    expect(prompt.messages[0].content.text).toContain(SIGNUP)
    expect((handleRpc(w.ctx, w.agent, rpc('prompts/get', { name: 'take_a_link_down' })) as any).error.code).toBe(-32602)
  })

  it('runs a tool and returns structured content', async () => {
    const w = await world()
    const r = (handleRpc(w.ctx, w.agent, rpc('tools/call', { name: 'find_links', arguments: { url: SIGNUP } })) as any).result
    expect(r.isError).toBe(false)
    expect(r.structuredContent.total).toBe(3)
    expect(JSON.parse(r.content[0].text).total).toBe(3)
  })

  it('answers a failed tool as an error the model can act on', async () => {
    const w = await world()
    const bad = (handleRpc(w.ctx, w.agent, rpc('tools/call', { name: 'remove_link', arguments: { url: SIGNUP, reason: 'x' } })) as any).result
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(/^ERROR validation_failed/)
    expect(bad.content[0].text).toMatch(/What to do:/)
    expect(bad.content[0].text).toMatch(/everywhere|page_id/)
    const unknown = (handleRpc(w.ctx, w.agent, rpc('tools/call', { name: 'delete_site', arguments: {} })) as any).result
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0].text).toContain('There is no tool called')
    const wrong = (handleRpc(w.ctx, w.agent, rpc('tools/call', { name: 'get_page', arguments: { path: '/nowhere' } })) as any).result
    expect(wrong.content[0].text).toMatch(/ERROR not_found/)
  })

  it('parses single messages and batches', () => {
    expect('messages' in parseRpc(rpc('ping'))).toBe(true)
    const b = parseRpc([rpc('ping', undefined, 1), rpc('ping', undefined, 2)])
    expect('messages' in b && b.messages.length === 2 && b.batch).toBe(true)
    expect('error' in parseRpc({ nope: true })).toBe(true)
    expect('error' in parseRpc([])).toBe(true)
  })
})

describe('rules inside the agent context budget', () => {
  it('refuses rules too long to load, and get_site with the longest rules still fits', async () => {
    const w = await world()
    const paths = Array.from({ length: 50 }, (_, i) => `/a-long-section-name-for-budget-tests/page-${i}/*`)
    const rule = (i: number) => ({ label: `Rule ${i}`, actions: ['edit_text'], result: 'publish', targets: { pagePaths: paths } })
    const big = Array.from({ length: 50 }, (_, i) => rule(i))
    expect(JSON.stringify(big).length).toBeGreaterThan(AGENT_RULES_MAX_CHARS)
    expect(() => createAgentToken(w.ctx, w.admin, { name: 'Too many rules', access: 'draft', rules: big } as never)).toThrow(/too long for an AI/)
    // Fill the rules up to just under the cap, then measure what an agent loads.
    const fits: ReturnType<typeof rule>[] = []
    for (let i = 0; JSON.stringify([...fits, rule(i)]).length <= AGENT_RULES_MAX_CHARS - 200; i++) fits.push(rule(i))
    const made = createAgentToken(w.ctx, w.admin, { name: 'Many rules', access: 'draft', rules: fits } as never)
    const agent = authenticateAgent(w.ctx, made.secret, null)
    expect(JSON.stringify(getSite(w.ctx, agent), null, 2).length).toBeLessThan(budgetChars(AGENT_BUDGET_TOKENS.rules))
  })
})
