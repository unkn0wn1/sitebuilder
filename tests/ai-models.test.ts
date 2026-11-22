import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sites } from '../server/db/schema'
import { secretKeyFromEnv, setSecret } from '../server/services/auth'
import { clearXaiModelCache, listXaiModels } from '../server/services/ai-models'
import { CURATED_XAI_MODELS, resolveAiModel, selectChatModels } from '../shared/ai-models'
import { mergeSettings, readSettings } from '../shared/settings'
import { setup } from './helpers'

const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  clearXaiModelCache()
})

afterEach(() => {
  clearXaiModelCache()
})

describe('resolveAiModel', () => {
  it('prefers a saved non-legacy id, then the legacy default, then the provider default', () => {
    expect(resolveAiModel('xai', 'grok-4.5')).toBe('grok-4.5')
    expect(resolveAiModel('xai', 'grok-4')).toBe('grok-4.7')
    expect(resolveAiModel('xai', '')).toBe('grok-4.7')
    expect(resolveAiModel('xai', null)).toBe('grok-4.7')
    expect(resolveAiModel('openai', 'gpt-4o')).toBe('gpt-4o')
    expect(resolveAiModel('openai', 'grok-4')).toBe('grok-4')
    expect(resolveAiModel('openai', '')).toBe('gpt-4o')
    expect(resolveAiModel('anthropic', undefined)).toBe('claude-sonnet-4-5')
    expect(resolveAiModel('custom', undefined)).toBe('')
  })
})

describe('settings migration', () => {
  it('reads a missing model and a stored grok-4 on xAI as grok-4.7', () => {
    expect(readSettings({}).ai).toMatchObject({ provider: 'xai', model: 'grok-4.7' })
    const legacy = readSettings({ ai: { provider: 'xai', model: 'grok-4', enabled: false, smallModel: 'grok-4' } })
    expect(legacy.ai.model).toBe('grok-4.7')
    expect(legacy.ai.smallModel).toBe('grok-4')
    expect(legacy.ai.enabled).toBe(false)
  })

  it('still parses settings that have no ai key, and keeps a non-xAI grok-4', () => {
    const bare = readSettings({ titlePattern: '{page}' })
    expect(bare.titlePattern).toBe('{page}')
    expect(bare.ai.model).toBe('grok-4.7')
    expect(readSettings({ ai: { provider: 'openai', model: 'grok-4' } }).ai.model).toBe('grok-4')
    expect(readSettings({ ai: { provider: 'openai', model: 'gpt-4o' } }).ai.model).toBe('gpt-4o')
    expect(readSettings({ ai: { provider: 'xai', model: 'grok-4.20-0309-reasoning' } }).ai.model).toBe('grok-4.20-0309-reasoning')
  })

  it('rewrites a legacy model when the next save merges an unrelated patch', () => {
    const legacy = readSettings({})
    legacy.ai = { ...legacy.ai, provider: 'xai', model: 'grok-4', smallModel: 'grok-4' }
    const next = mergeSettings(legacy, { ai: { enabled: true } })
    expect(next.ai.model).toBe('grok-4.7')
    expect(next.ai.enabled).toBe(true)
    expect(next.ai.smallModel).toBe('grok-4')
  })
})

describe('selectChatModels', () => {
  it('drops image, video, voice, embedding and tts ids, and keeps chat ids', () => {
    const ids = selectChatModels(
      [
        'grok-2-image',
        'grok-imagine-video',
        'grok-voice',
        'text-embedding-3',
        'tts-1',
        'grok-4.6',
        'grok-2-vision-1212',
        'grok-4.7',
        'zeta-chat',
        'audio-1',
      ],
      'my-fine-tune',
    )
    expect(ids).toEqual(['grok-4.7', 'grok-4.6', 'grok-2-vision-1212', 'zeta-chat', 'my-fine-tune'])
    for (const curated of CURATED_XAI_MODELS) expect(selectChatModels([curated])).toEqual([curated])
  })

  it('appends a saved id that the live list filtered out', () => {
    expect(selectChatModels(['grok-2-image', 'grok-4.7'], 'grok-2-image')).toEqual(['grok-4.7', 'grok-2-image'])
  })
})

describe('listXaiModels', () => {
  function saveKey(s: ReturnType<typeof setup>, value = 'sk-test') {
    const prev = process.env.SITEBUILDER_SECRET_KEY
    process.env.SITEBUILDER_SECRET_KEY = KEY
    setSecret(s.ctx, secretKeyFromEnv(KEY), 'ai_api_key', value, s.admin.id)
    return () => {
      if (prev === undefined) delete process.env.SITEBUILDER_SECRET_KEY
      else process.env.SITEBUILDER_SECRET_KEY = prev
    }
  }

  it('does not call xAI when the site has no key', async () => {
    const s = setup()
    let calls = 0
    const result = await listXaiModels(s.ctx, {
      fetch: async () => {
        calls += 1
        return new Response('{}', { status: 200 })
      },
    })
    expect(calls).toBe(0)
    expect(result).toEqual({ source: 'curated', models: CURATED_XAI_MODELS.map((id) => ({ id })) })
    s.sqlite.close()
  })

  it('falls back to the curated list when fetch throws, aborts, or returns 401', async () => {
    const s = setup()
    const restore = saveKey(s)
    const curated = { source: 'curated' as const, models: CURATED_XAI_MODELS.map((id) => ({ id })) }
    await expect(listXaiModels(s.ctx, { fetch: async () => { throw new Error('network down') } })).resolves.toEqual(curated)
    clearXaiModelCache()
    await expect(listXaiModels(s.ctx, { fetch: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) } })).resolves.toEqual(curated)
    clearXaiModelCache()
    await expect(listXaiModels(s.ctx, { fetch: async () => new Response('no', { status: 401 }) })).resolves.toEqual(curated)
    clearXaiModelCache()
    await expect(listXaiModels(s.ctx, { fetch: async () => new Response('not-json', { status: 200 }) })).resolves.toEqual(curated)
    restore()
    s.sqlite.close()
  })

  it('returns a filtered live list and reuses it for 60 seconds', async () => {
    const s = setup()
    const restore = saveKey(s)
    const row = s.ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, s.ctx.siteId)).get()!
    const settings = readSettings(row.settings)
    s.ctx.db.update(sites).set({ settings: { ...settings, ai: { ...settings.ai, model: 'my-fine-tune' } } }).where(eq(sites.id, s.ctx.siteId)).run()
    let calls = 0
    const fetch = async (url: string, init?: RequestInit) => {
      calls += 1
      expect(url).toBe('https://api.x.ai/v1/models')
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer sk-test')
      expect(headers.accept).toBe('application/json')
      return new Response(
        JSON.stringify({
          data: [
            { id: 'grok-2-image' },
            { id: 'grok-imagine-video' },
            { id: 'grok-voice' },
            { id: 'text-embedding-3' },
            { id: 'tts-1' },
            { id: 'grok-4.6' },
            { id: 'grok-2-vision-1212' },
            { id: 'zeta-chat' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const now = 1_700_000_000_000
    const first = await listXaiModels(s.ctx, { fetch, now })
    const second = await listXaiModels(s.ctx, { fetch, now: now + 30_000 })
    expect(calls).toBe(1)
    expect(first.source).toBe('live')
    expect(first.models.map((m) => m.id)).toEqual(['grok-4.6', 'grok-2-vision-1212', 'zeta-chat', 'my-fine-tune'])
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('sk-test')
    restore()
    s.sqlite.close()
  })
})
