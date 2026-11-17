import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { media, sites } from '../server/db/schema'
import { suggestAltForMedia, suggestAltForMediaBatch, cleanSuggestedAlt, ALT_TEXT_SYSTEM_PROMPT } from '../server/services/alt-text'
import { assistantText, mockProvider, type ChatRequest } from '../server/services/ai-provider'
import { uploadMedia, updateMedia } from '../server/services/media'
import { readSettings } from '../shared/settings'
import { setup } from './helpers'

function enableAi(ctx: ReturnType<typeof setup>['ctx'], patch: Record<string, unknown> = {}) {
  const current = ctx.db.select({ settings: sites.settings }).from(sites).where(eq(sites.id, ctx.siteId)).get()!
  const settings = readSettings(current.settings)
  ctx.db.update(sites).set({ settings: { ...settings, ai: { ...settings.ai, enabled: true, ...patch } } }).where(eq(sites.id, ctx.siteId)).run()
}

async function jpeg(width = 320, height = 240) {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 80 } } }).jpeg().toBuffer()
}

describe('suggested alt text', () => {
  it('cleans model output, trims prefixes, and never exceeds 250 characters', () => {
    expect(cleanSuggestedAlt('  "A dog sitting on a blanket."  ')).toBe('A dog sitting on a blanket.')
    expect(cleanSuggestedAlt('Photo of a volunteer holding a bowl of food.')).toBe('A volunteer holding a bowl of food.')
    expect(cleanSuggestedAlt('unclear')).toBeNull()
    expect(cleanSuggestedAlt('Unclear — the image is too dark.')).toBeNull()
    const long = 'A '.repeat(200)
    expect(cleanSuggestedAlt(long)!.length).toBeLessThanOrEqual(250)
    expect(cleanSuggestedAlt(long)!.endsWith('…')).toBe(true)
  })

  it('asks the configured provider with a vision image and does not save the suggestion', async () => {
    const s = setup()
    enableAi(s.ctx, { smallModel: 'grok-small' })
    const dir = mkdtempSync(join(tmpdir(), 'sb-alt-'))
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'field.jpg', data: await jpeg(), mediaDir: dir })
    const provider = mockProvider([
      (req: ChatRequest) => {
        expect(req.model).toBe('grok-small')
        expect(req.messages[0]?.content).toBe(ALT_TEXT_SYSTEM_PROMPT)
        expect(ALT_TEXT_SYSTEM_PROMPT).toMatch(/Never invent names/)
        expect(ALT_TEXT_SYSTEM_PROMPT).toMatch(/places/)
        const user = req.messages[1]?.content
        expect(Array.isArray(user)).toBe(true)
        const parts = user as { type: string; text?: string; image_url?: { url: string } }[]
        expect(parts.some((p) => p.type === 'text' && p.text?.includes('do not invent names or places'))).toBe(true)
        expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/jpeg;base64,'))).toBe(true)
        return assistantText('A green field under a clear sky.')
      },
    ])
    s.ctx.aiProvider = provider
    const result = await suggestAltForMedia(s.ctx, s.editor, up.media.id, { mediaDir: dir })
    expect(result.suggestion).toBe('A green field under a clear sky.')
    expect(result.mediaId).toBe(up.media.id)
    expect(s.ctx.db.select().from(media).where(eq(media.id, up.media.id)).get()?.alt).toBeNull()
    expect(provider.calls).toHaveLength(1)
    s.sqlite.close()
  })

  it('leaves invented-looking names unsaved and treats an unclear reply as no suggestion', async () => {
    const s = setup()
    enableAi(s.ctx)
    const dir = mkdtempSync(join(tmpdir(), 'sb-alt-'))
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'dog.jpg', data: await jpeg(), mediaDir: dir })
    s.ctx.aiProvider = mockProvider([assistantText('unclear')])
    const result = await suggestAltForMedia(s.ctx, s.editor, up.media.id, { mediaDir: dir })
    expect(result.suggestion).toBeNull()
    expect(result.message).toMatch(/could not suggest/i)
    expect(s.ctx.db.select().from(media).where(eq(media.id, up.media.id)).get()?.alt).toBeNull()
    s.sqlite.close()
  })

  it('batch-suggests only ready images that are missing alt text', async () => {
    const s = setup()
    enableAi(s.ctx)
    const dir = mkdtempSync(join(tmpdir(), 'sb-alt-'))
    const one = await uploadMedia(s.ctx, s.editor, { filename: 'one.jpg', data: await jpeg(200, 160), mediaDir: dir })
    const two = await uploadMedia(s.ctx, s.editor, { filename: 'two.jpg', data: await jpeg(201, 160), mediaDir: dir })
    const hasAlt = await uploadMedia(s.ctx, s.editor, { filename: 'has-alt.jpg', data: await jpeg(202, 160), mediaDir: dir })
    updateMedia(s.ctx, s.editor, hasAlt.media.id, { alt: 'A bowl of food already described.' })
    s.ctx.aiProvider = mockProvider([
      assistantText('A green field.'),
      assistantText('A darker green field.'),
      assistantText('Should not be called'),
    ])
    const batch = await suggestAltForMediaBatch(s.ctx, s.editor, { mediaDir: dir })
    expect(batch.items.map((i) => i.filename).sort()).toEqual(['one.jpg', 'two.jpg'])
    expect(batch.items.every((i) => i.suggestion)).toBe(true)
    expect(batch.items).toHaveLength(2)
    expect(s.ctx.db.select().from(media).where(eq(media.id, hasAlt.media.id)).get()?.alt).toBe('A bowl of food already described.')
    expect(s.ctx.db.select().from(media).where(eq(media.id, one.media.id)).get()?.alt).toBeNull()
    s.sqlite.close()
  })

  it('refuses when the assistant is off', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-alt-'))
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'field.jpg', data: await jpeg(), mediaDir: dir })
    await expect(suggestAltForMedia(s.ctx, s.editor, up.media.id, { mediaDir: dir })).rejects.toMatchObject({ code: 'ai_unavailable' })
    s.sqlite.close()
  })
})
