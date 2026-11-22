// Live xAI model list for the Settings picker. Failures fall back to the curated list. Never logs the key.
import { eq } from 'drizzle-orm'
import { CURATED_XAI_MODELS, selectChatModels } from '../../shared/ai-models'
import { readSettings, type SiteSettings } from '../../shared/settings'
import { sites } from '../db/schema'
import { getSecret, secretKeyFromEnv, sha256 } from './auth'
import type { ServiceCtx } from './context'
import { isXaiOauthConnected, xaiOauthAccessToken } from './xai-oauth'

const MODELS_URL = 'https://api.x.ai/v1/models'
const CACHE_MS = 60_000

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface XaiModelList {
  source: 'live' | 'curated'
  models: { id: string }[]
}

interface CacheEntry {
  at: number
  ids: string[]
}

const cache = new Map<string, CacheEntry>()

export function clearXaiModelCache() {
  cache.clear()
}

function asModels(ids: string[]): { id: string }[] {
  return ids.map((id) => ({ id }))
}

function curated(current: string): XaiModelList {
  return { source: 'curated', models: asModels(selectChatModels(CURATED_XAI_MODELS, current)) }
}

function idsFromBody(body: unknown): string[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) return null
  const ids: string[] = []
  for (const row of (body as { data: unknown[] }).data) {
    if (!row || typeof row !== 'object') continue
    const id = (row as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) ids.push(id.trim())
  }
  return ids
}

/** xAI OAuth when that is how this site signs in, otherwise the stored API key. Throws become "no credential". */
async function xaiBearer(ctx: ServiceCtx, provider: SiteSettings['ai']['provider']): Promise<string | null> {
  try {
    if (provider === 'xai' && isXaiOauthConnected(ctx)) {
      const token = (await xaiOauthAccessToken(ctx)).trim()
      return token || null
    }
    const stored = getSecret(ctx, secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY), 'ai_api_key')
    return stored?.trim() || null
  } catch {
    return null
  }
}

export async function listXaiModels(ctx: ServiceCtx, opts: { fetch?: FetchFn; now?: number } = {}): Promise<XaiModelList> {
  const site = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  const ai = readSettings(site?.settings).ai
  const bearer = await xaiBearer(ctx, ai.provider)
  if (!bearer) return curated(ai.model)

  const now = opts.now ?? Date.now()
  const key = `${ctx.siteId}:${sha256(bearer).slice(0, 12)}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return { source: 'live', models: asModels(selectChatModels(hit.ids, ai.model)) }

  try {
    const fetchImpl = opts.fetch ?? fetch
    const res = await fetchImpl(MODELS_URL, {
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return curated(ai.model)
    const ids = idsFromBody(await res.json())
    if (!ids) return curated(ai.model)
    const filtered = selectChatModels(ids)
    cache.set(key, { at: now, ids: filtered })
    return { source: 'live', models: asModels(selectChatModels(filtered, ai.model)) }
  } catch {
    return curated(ai.model)
  }
}
