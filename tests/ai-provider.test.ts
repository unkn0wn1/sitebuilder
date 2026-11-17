import { describe, expect, it } from 'vitest'
import { costMicrosFor, penceToMicros } from '../shared/ai-pricing'
import { assistantText, assistantTools, mockProvider, openAiCompatibleProvider, ProviderError } from '../server/services/ai-provider'

describe('cost estimates', () => {
  it('converts tokens into millionths of a pound, rounding up', () => {
    expect(penceToMicros(50)).toBe(500_000)
    // 1000 in + 500 out at default 100 / 400 pence per million → (1000*100 + 500*400) / 100 = 3000 micros
    expect(costMicrosFor('unknown-model', 1000, 500)).toBe(3000)
    expect(costMicrosFor('grok-4', 0, 0)).toBe(0)
    expect(costMicrosFor('grok-4', 1, 0)).toBeGreaterThan(0)
  })
})

describe('mock provider', () => {
  it('plays scripted replies in order and never touches the network', async () => {
    const provider = mockProvider([assistantText('Hello'), assistantTools([{ name: 'get_page', arguments: {} }])])
    const first = await provider.complete({ model: 'mock', messages: [{ role: 'user', content: 'Hi' }] })
    expect(first.message.content).toBe('Hello')
    const second = await provider.complete({ model: 'mock', messages: [] })
    expect(second.message.tool_calls?.[0]?.name).toBe('get_page')
    await expect(provider.complete({ model: 'mock', messages: [] })).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('OpenAI-compatible adapter', () => {
  it('posts chat completions and reads tool calls and usage', async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
    const provider = openAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1/',
      apiKey: 'sk-test',
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> })
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_page', arguments: '{}' } }] } }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    })
    const result = await provider.complete({
      model: 'grok-4',
      messages: [{ role: 'user', content: 'Show me the page' }],
      tools: [{ type: 'function', function: { name: 'get_page', description: 'Read the page', parameters: { type: 'object', properties: {} } } }],
    })
    expect(calls[0]?.url).toBe('https://api.example.test/v1/chat/completions')
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-test')
    expect(calls[0]?.body.model).toBe('grok-4')
    expect(result.message.tool_calls?.[0]).toMatchObject({ name: 'get_page', id: 'c1' })
    expect(result.usage).toEqual({ tokensIn: 12, tokensOut: 3 })
  })

  it('turns HTTP and timeout errors into ProviderError', async () => {
    const failing = openAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-test',
      fetch: async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
    })
    await expect(failing.complete({ model: 'x', messages: [] })).rejects.toMatchObject({ name: 'ProviderError', message: 'bad key', status: 401 })

    const hanging = openAiCompatibleProvider({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-test',
      timeoutMs: 10,
      fetch: async (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        }),
    })
    await expect(hanging.complete({ model: 'x', messages: [] })).rejects.toMatchObject({ name: 'ProviderError', message: /timed out/ })
  })
})
