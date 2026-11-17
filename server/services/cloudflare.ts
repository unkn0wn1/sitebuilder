// Cloudflare cache purge by tag (ADR 0004). Every plan can purge by tag since April 2025.
// The job batches tags (100 per request) and retries a rate-limit reply. Skips when the
// zone or API token is not configured, so local development does not fail a publish.
import { getSecret, secretKeyFromEnv } from './auth'
import type { ServiceCtx } from './context'
import type { JobHandler } from './jobs'

const PURGE_URL = (zoneId: string) => `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`
const TAGS_PER_REQUEST = 100
const MAX_ATTEMPTS = 4

export interface PurgeResult {
  skipped?: string
  purged?: string[]
  [key: string]: unknown
}

type FetchLike = typeof fetch

let purgeHttp: FetchLike = fetch

/** Tests replace fetch. Production always uses the platform fetch. */
export function setPurgeHttp(fn: FetchLike | null) {
  purgeHttp = fn ?? fetch
}

function zoneId(): string | null {
  return process.env.SITEBUILDER_CLOUDFLARE_ZONE_ID?.trim() || null
}

function apiToken(ctx: ServiceCtx): string | null {
  const fromEnv = process.env.SITEBUILDER_CLOUDFLARE_TOKEN?.trim()
  if (fromEnv) return fromEnv
  if (!process.env.SITEBUILDER_SECRET_KEY) return null
  try {
    return getSecret(ctx, secretKeyFromEnv(process.env.SITEBUILDER_SECRET_KEY), 'cloudflare_token')
  } catch {
    return null
  }
}

function batches(tags: string[]): string[][] {
  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  const out: string[][] = []
  for (let i = 0; i < unique.length; i += TAGS_PER_REQUEST) out.push(unique.slice(i, i + TAGS_PER_REQUEST))
  return out
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function purgeTags(ctx: ServiceCtx, tags: string[]): Promise<PurgeResult> {
  const zone = zoneId()
  const token = apiToken(ctx)
  if (!zone || !token) return { skipped: 'Cloudflare zone or token is not configured.' }
  const purged: string[] = []
  for (const batch of batches(tags)) {
    let attempt = 0
    for (;;) {
      attempt++
      const res = await purgeHttp(PURGE_URL(zone), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: batch }),
      })
      if (res.ok) {
        purged.push(...batch)
        break
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * attempt)
        continue
      }
      const body = await res.text().catch(() => '')
      throw new Error(`Cloudflare purge failed (${res.status}): ${body.slice(0, 300)}`)
    }
  }
  return { purged }
}

export function createPurgeCacheHandler(): JobHandler {
  return {
    async run(ctx, job) {
      const tags = (job.payload as { tags?: string[] }).tags ?? []
      if (!tags.length) return { skipped: 'No cache tags to purge.' }
      return purgeTags(ctx, tags)
    },
  }
}
