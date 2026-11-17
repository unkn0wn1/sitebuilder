import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { aiMessages, templates } from '../server/db/schema'
import { AppError } from '../server/services/errors'
import { runTool, startAiSession } from '../server/services/ai'
import { approveCrop, uploadMedia } from '../server/services/media'
import { createPage, getPage } from '../server/services/pages'
import { setup, IMG } from './helpers'

async function photo(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } }).jpeg().toBuffer()
}

describe('create_draft', () => {
  it('sets the title, template and address on the bound new page', async () => {
    const s = setup()
    const session = startAiSession(s.ctx, s.editor, { taskType: 'new_page' })
    expect(getPage(s.ctx, session.targetId).page.title).toBe('Untitled page')
    expect(getPage(s.ctx, session.targetId).page.slug.startsWith('untitled-')).toBe(true)

    const res = await runTool(s.ctx, s.editor, session.id, 'create_draft', { title: 'Winter appeal', template: 'campaign' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const result = res.result as { pageId: string; title: string; template: string; path: string }
    expect(result.pageId).toBe(session.targetId)
    expect(result.title).toBe('Winter appeal')
    expect(result.template).toBe('campaign')
    expect(result.path).toBe('/winter-appeal')
    const page = getPage(s.ctx, session.targetId).page
    expect(page.title).toBe('Winter appeal')
    expect(page.template).toBe('campaign')
    expect(page.slug).toBe('winter-appeal')
  })

  it('keeps a slug the person already set, and stays bound to one page', async () => {
    const s = setup()
    const session = startAiSession(s.ctx, s.editor, { taskType: 'new_page' })
    await runTool(s.ctx, s.editor, session.id, 'create_draft', { title: 'Winter appeal', slug: 'winter-2026' })
    const again = await runTool(s.ctx, s.editor, session.id, 'create_draft', { title: 'Winter appeal 2026' })
    expect(again.ok).toBe(true)
    expect(getPage(s.ctx, session.targetId).page.slug).toBe('winter-2026')
    expect(getPage(s.ctx, session.targetId).page.title).toBe('Winter appeal 2026')

    const other = createPage(s.ctx, s.editor, { title: 'About us', template: 'standard' }).page
    const hijack = await runTool(s.ctx, s.editor, session.id, 'create_draft', { pageId: other.id, title: 'Hijacked' })
    expect(hijack).toMatchObject({ ok: false })
    expect(getPage(s.ctx, other.id).page.title).toBe('About us')
  })

  it('is only on new page tasks, including an admin who is still bound', async () => {
    const s = setup()
    const existing = createPage(s.ctx, s.admin, { title: 'Live-ish', template: 'standard' }).page
    const edit = startAiSession(s.ctx, s.admin, { taskType: 'page_edit', targetId: existing.id })
    expect(await runTool(s.ctx, s.admin, edit.id, 'create_draft', { title: 'Nope' })).toMatchObject({ ok: false })

    const fresh = startAiSession(s.ctx, s.admin, { taskType: 'new_page' })
    const ok = await runTool(s.ctx, s.admin, fresh.id, 'create_draft', { title: 'From admin', template: 'story' })
    expect(ok.ok).toBe(true)
    expect(getPage(s.ctx, fresh.targetId).page.template).toBe('story')
    expect(await runTool(s.ctx, s.admin, fresh.id, 'create_draft', { title: 'Bad', template: 'does-not-exist' })).toMatchObject({ ok: false })
  })
})

describe('request_upload and crop_media', () => {
  it('asks the person to upload, and records the request on the session', async () => {
    const s = setup()
    const session = startAiSession(s.ctx, s.editor, { taskType: 'new_page' })
    expect(await runTool(s.ctx, s.editor, session.id, 'request_upload', {})).toMatchObject({ ok: false })
    const res = await runTool(s.ctx, s.editor, session.id, 'request_upload', {
      purpose: 'Hero photo',
      message: 'A warm winter photo of a dog, 16:9 if you can.',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const result = res.result as { needsYou: string; requestId: string; purpose: string }
    expect(result.needsYou).toBe('upload')
    expect(result.purpose).toBe('Hero photo')
    const stored = s.ctx.db.select().from(aiMessages).where(eq(aiMessages.id, result.requestId)).get()
    expect(stored?.role).toBe('tool')
    expect((stored?.content as { needsYou: string }).needsYou).toBe('upload')
  })

  it('proposes a crop without applying it, and refuses to approve as the assistant', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-ai-media-'))
    const { media } = await uploadMedia(s.ctx, s.editor, { filename: 'hero.jpg', data: await photo(1600, 900), mediaDir: dir })
    const page = createPage(s.ctx, s.editor, { title: 'Appeal', template: 'standard' }).page
    const session = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: page.id })
    const added = await runTool(s.ctx, s.editor, session.id, 'add_block', { block: { type: 'Hero', props: { heading: 'Warm', image: { media: media.id, alt: 'A dog' } } } })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const blockId = (added.result as { blocks: { id: string; type: string }[] }).blocks.find((b) => b.type === 'Hero')!.id

    const proposed = await runTool(s.ctx, s.editor, session.id, 'crop_media', { mediaId: media.id, blockId })
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    const result = proposed.result as { needsYou: string; ratio: string; rect: { x: number; y: number; width: number; height: number }; suggested: boolean }
    expect(result.needsYou).toBe('approve_crop')
    expect(result.ratio).toBe('16:9')
    expect(result.rect).toEqual({ x: 0, y: 0, width: 1600, height: 900 })
    expect(result.suggested).toBe(true)
    expect(s.ctx.db.select().from(aiMessages).all()).toHaveLength(1)

    // Not applied: no approved crop rows yet.
    const { getMedia } = await import('../server/services/media')
    expect(getMedia(s.ctx, media.id).crops).toHaveLength(0)

    const asAi = { ...s.editor, aiSessionId: session.id }
    expect(() => approveCrop(s.ctx, asAi, media.id, { ratio: '16:9', rect: result.rect })).toThrow(AppError)
    expect(() => approveCrop(s.ctx, asAi, media.id, { ratio: '16:9', rect: result.rect })).toThrow(/person has to approve/)

    // The person can still approve the same proposal.
    const approved = approveCrop(s.ctx, s.editor, media.id, { ratio: '16:9', rect: result.rect })
    expect(approved.cropId).toMatch(/^crp_/)
    expect(getMedia(s.ctx, media.id).crops).toHaveLength(1)
  })

  it('rejects a crop of another page\'s section, and a rectangle that does not fit', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-ai-media-'))
    const { media } = await uploadMedia(s.ctx, s.editor, { filename: 'hero.jpg', data: await photo(1600, 900), mediaDir: dir })
    const a = createPage(s.ctx, s.editor, { title: 'A', template: 'standard' }).page
    const b = createPage(s.ctx, s.editor, { title: 'B', template: 'standard' }).page
    const sessionA = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: a.id })
    const sessionB = startAiSession(s.ctx, s.editor, { taskType: 'page_edit', targetId: b.id })
    const added = await runTool(s.ctx, s.editor, sessionB.id, 'add_block', { block: { type: 'Hero', props: { heading: 'B', image: IMG } } })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const blockId = (added.result as { blocks: { id: string }[] }).blocks[0]!.id

    const otherBlock = await runTool(s.ctx, s.editor, sessionA.id, 'crop_media', { mediaId: media.id, blockId, ratio: '1:1' })
    expect(otherBlock).toMatchObject({ ok: false })
    if (!otherBlock.ok) expect(otherBlock.error).toMatch(/isn't on this page/)

    const bad = await runTool(s.ctx, s.editor, sessionA.id, 'crop_media', { mediaId: media.id, ratio: '1:1', rect: { x: 0, y: 0, width: 800, height: 400 } })
    expect(bad).toMatchObject({ ok: false })
  })
})

describe('preview_screenshot', () => {
  it('returns schematic webp images at desktop and mobile widths, without a model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-preview-'))
    const s = setup()
    const ctx = { ...s.ctx, filesDir: dir }
    const session = startAiSession(ctx, s.editor, { taskType: 'new_page' })
    await runTool(ctx, s.editor, session.id, 'create_draft', { title: 'Winter appeal' })
    await runTool(ctx, s.editor, session.id, 'add_block', { block: { type: 'Quote', props: { text: 'Keep them warm' } } })

    const res = await runTool(ctx, s.editor, session.id, 'preview_screenshot', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const result = res.result as { kind: string; images: { width: number; height: number; mime: string; bytes: number; path: string }[] }
    expect(result.kind).toBe('schematic')
    expect(result.images.map((i) => i.width)).toEqual([1280, 390])
    for (const image of result.images) {
      expect(image.mime).toBe('image/webp')
      expect(image.bytes).toBeGreaterThan(100)
      const full = join(dir, image.path)
      expect(existsSync(full)).toBe(true)
      const meta = await sharp(readFileSync(full)).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.width).toBe(image.width)
    }
  })

  it('accepts a device width and works on a template task, still bound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-preview-'))
    const s = setup()
    const ctx = { ...s.ctx, filesDir: dir }
    const tpl = ctx.db.select().from(templates).where(eq(templates.key, 'story')).get()!
    const session = startAiSession(ctx, s.admin, { taskType: 'template', targetId: tpl.id })
    const res = await runTool(ctx, s.admin, session.id, 'preview_screenshot', { device: 'tablet' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const result = res.result as { images: { width: number }[] }
    expect(result.images.map((i) => i.width)).toEqual([768])
    expect(await runTool(ctx, s.admin, session.id, 'create_draft', { title: 'Nope' })).toMatchObject({ ok: false })
    await expect(runTool(ctx, s.editor, session.id, 'preview_screenshot', {})).rejects.toThrow(/wasn't found/)
  })

  it('rejects a silly width', async () => {
    const s = setup()
    const session = startAiSession(s.ctx, s.editor, { taskType: 'new_page' })
    const res = await runTool(s.ctx, s.editor, session.id, 'preview_screenshot', { width: 12 })
    expect(res.ok).toBe(false)
  })
})
