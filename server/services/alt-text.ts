// Suggested alt text for library images. Suggestions are never applied automatically.
// Uses the configured AI provider (xAI OAuth or API key) with a vision-capable model.
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { can } from '../../shared/roles'
import { costMicrosFor } from '../../shared/ai-pricing'
import { media } from '../db/schema'
import { addAiUsage, startAiSession } from './ai'
import { resolveAi, resolveProvider, unavailableMessage } from './ai-loop'
import type { ChatMessage, ModelProvider } from './ai-provider'
import type { ActingAs, ServiceCtx } from './context'
import { AppError, forbidden } from './errors'
import { getMedia, isSvgMedia, masterPath, type MediaRow } from './media'

export const ALT_TEXT_MAX = 250
export const ALT_TEXT_BATCH_LIMIT = 20

export const ALT_TEXT_SYSTEM_PROMPT = `You write short alternative text for photographs used on a charity website.

Rules:
- Describe only what is clearly visible in the image.
- Never invent names of people, animals, organisations or places.
- Never invent a location, date, or a story that is not visible.
- Do not guess breeds, identities, or cities.
- One or two short sentences of UK English.
- Do not wrap the answer in quotation marks.
- Do not start with "image of", "photo of", or "picture of".
- Aim for under 125 characters. Never exceed 250 characters.
- If the image is unclear or purely decorative, reply with exactly: unclear

Return only the alt text.`

export function cleanSuggestedAlt(raw: string | null | undefined): string | null {
  if (!raw) return null
  let text = raw.trim()
  if (!text) return null
  text = text.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim()
  if (/^unclear\b/i.test(text)) return null
  text = text.replace(/^(an?\s+)?(image|photo|photograph|picture)\s+of\s+/i, '').trim()
  text = text.replace(/\s+/g, ' ')
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1)
  if (text.length > ALT_TEXT_MAX) {
    const sliced = text.slice(0, ALT_TEXT_MAX - 1)
    text = `${sliced.replace(/\s+\S*$/, '').trimEnd() || sliced.trimEnd()}…`
  }
  return text || null
}

export async function imageDataUrlForAlt(filePath: string): Promise<string> {
  const buf = await sharp(filePath, { density: 144, failOn: 'none' })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

export function mediaNeedsAlt(row: Pick<MediaRow, 'kind' | 'status' | 'decorative' | 'alt' | 'deletedAt'>): boolean {
  if (row.deletedAt) return false
  if (row.kind !== 'image' && row.kind !== 'svg') return false
  if (row.status === 'failed') return false
  if (row.decorative) return false
  return !row.alt?.trim()
}

export function listMediaNeedingAlt(ctx: ServiceCtx, limit = ALT_TEXT_BATCH_LIMIT): MediaRow[] {
  return ctx.db
    .select()
    .from(media)
    .where(
      and(
        eq(media.siteId, ctx.siteId),
        isNull(media.deletedAt),
        inArray(media.kind, ['image', 'svg']),
        or(eq(media.status, 'ready'), eq(media.status, 'processing')),
        eq(media.decorative, false),
        or(isNull(media.alt), eq(media.alt, '')),
      ),
    )
    .orderBy(media.createdAt)
    .limit(limit)
    .all()
}

export type AltSuggestion = {
  mediaId: string
  filename: string
  suggestion: string | null
  message?: string
}

async function suggestOne(ctx: ServiceCtx, actor: ActingAs, row: MediaRow, mediaDir: string, provider: ModelProvider, model: string): Promise<AltSuggestion> {
  const path = masterPath(mediaDir, row)
  if (!existsSync(path)) {
    return { mediaId: row.id, filename: row.filename, suggestion: null, message: 'The original file is missing.' }
  }
  let dataUrl: string
  try {
    dataUrl = isSvgMedia(row) && !path.endsWith('.svg') ? await imageDataUrlForAlt(path) : await imageDataUrlForAlt(path)
  } catch {
    // sharp can fail on an odd SVG; last resort is to skip rather than invent text.
    if (isSvgMedia(row)) {
      const raw = readFileSync(path, 'utf8')
      if (!/<svg/i.test(raw)) return { mediaId: row.id, filename: row.filename, suggestion: null, message: 'Could not read that image.' }
    }
    return { mediaId: row.id, filename: row.filename, suggestion: null, message: 'Could not read that image.' }
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: ALT_TEXT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Write alt text for this image. Remember: do not invent names or places.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ]
  const session = startAiSession(ctx, actor, { taskType: 'alt_text', targetId: row.id })
  const result = await provider.complete({ model, messages })
  const cost = costMicrosFor(model, result.usage.tokensIn, result.usage.tokensOut)
  addAiUsage(ctx, session.id, result.usage.tokensIn, result.usage.tokensOut, cost, model)
  const suggestion = cleanSuggestedAlt(typeof result.message.content === 'string' ? result.message.content : null)
  if (!suggestion) {
    return { mediaId: row.id, filename: row.filename, suggestion: null, message: 'The assistant could not suggest alt text for this image. You can write it yourself.' }
  }
  return { mediaId: row.id, filename: row.filename, suggestion }
}

export async function suggestAltForMedia(
  ctx: ServiceCtx,
  actor: ActingAs,
  id: string,
  opts: { mediaDir: string; provider?: ModelProvider },
): Promise<AltSuggestion> {
  if (!can(actor, 'media.upload')) throw forbidden()
  const resolved = resolveAi(ctx)
  if (!resolved.available && !opts.provider && !ctx.aiProvider) {
    throw new AppError('ai_unavailable', unavailableMessage(resolved.reason))
  }
  const row = getMedia(ctx, id).media
  if (row.kind !== 'image' && row.kind !== 'svg') {
    throw new AppError('validation_failed', 'Alt text suggestions are for images.', [{ path: 'id', message: 'Not an image.' }])
  }
  if (row.decorative) {
    throw new AppError('validation_failed', 'Decorative images do not need alt text.')
  }
  const provider = resolveProvider(ctx, resolved, opts.provider ?? ctx.aiProvider)
  const model = resolved.settings.smallModel || resolved.settings.model
  if (!model) throw new AppError('ai_unavailable', unavailableMessage('no_model'))
  return suggestOne(ctx, actor, row, opts.mediaDir, provider, model)
}

export async function suggestAltForMediaBatch(
  ctx: ServiceCtx,
  actor: ActingAs,
  opts: { mediaDir: string; ids?: string[]; limit?: number; provider?: ModelProvider },
): Promise<{ items: AltSuggestion[]; remaining: number }> {
  if (!can(actor, 'media.upload')) throw forbidden()
  const resolved = resolveAi(ctx)
  if (!resolved.available && !opts.provider && !ctx.aiProvider) {
    throw new AppError('ai_unavailable', unavailableMessage(resolved.reason))
  }
  const limit = Math.min(Math.max(opts.limit ?? ALT_TEXT_BATCH_LIMIT, 1), ALT_TEXT_BATCH_LIMIT)
  let rows: MediaRow[]
  if (opts.ids?.length) {
    const unique = [...new Set(opts.ids)].slice(0, limit)
    rows = unique.map((id) => getMedia(ctx, id).media).filter((row) => mediaNeedsAlt(row))
  } else {
    rows = listMediaNeedingAlt(ctx, limit)
  }
  const remainingTotal = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(media)
    .where(
      and(
        eq(media.siteId, ctx.siteId),
        isNull(media.deletedAt),
        inArray(media.kind, ['image', 'svg']),
        or(eq(media.status, 'ready'), eq(media.status, 'processing')),
        eq(media.decorative, false),
        or(isNull(media.alt), eq(media.alt, '')),
      ),
    )
    .get()?.n ?? 0
  const provider = resolveProvider(ctx, resolved, opts.provider ?? ctx.aiProvider)
  const model = resolved.settings.smallModel || resolved.settings.model
  if (!model) throw new AppError('ai_unavailable', unavailableMessage('no_model'))
  const items: AltSuggestion[] = []
  for (const row of rows) {
    items.push(await suggestOne(ctx, actor, row, opts.mediaDir, provider, model))
  }
  return { items, remaining: Math.max(0, remainingTotal - rows.length) }
}
