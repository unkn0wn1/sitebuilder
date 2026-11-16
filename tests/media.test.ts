import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { AppError } from '../server/services/errors'
import { runJobsOnce } from '../server/services/jobs'
import { approveCrop, binMedia, createMediaRenditionsHandler, getMedia, listMedia, updateMedia, uploadMedia, widthsFor } from '../server/services/media'
import { applyPageOps, createPage } from '../server/services/pages'
import { createPublishHandler } from '../server/services/publish'
import { approveReview, submitPage } from '../server/services/reviews'
import { setup } from './helpers'

async function photo(width: number, height: number, opts: { orientation?: number; gps?: boolean } = {}) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } }).jpeg()
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation })
  if (opts.gps) img = img.withExif({ IFD0: { Copyright: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
  return img.toBuffer()
}

async function expectCode(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe('media', () => {
  it('stores an upright master without metadata, then makes AVIF and WebP renditions', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    const data = await photo(1000, 700, { orientation: 6, gps: true })
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'puppy <1>.jpg', data, mediaDir: dir })
    expect(up.media.status).toBe('processing')
    // Orientation 6 means rotated 90 degrees, so the stored image is portrait.
    expect([up.media.width, up.media.height]).toEqual([700, 1000])
    expect(up.media.filename).toBe('puppy _1_.jpg')
    const master = readFileSync(join(dir, 'originals', `${up.media.id}.jpg`))
    const meta = await sharp(master).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.orientation ?? 1).toBe(1)

    // Same file again is recognised.
    expect((await uploadMedia(s.ctx, s.editor, { filename: 'again.jpg', data, mediaDir: dir })).duplicate).toBe(true)

    await runJobsOnce(s.ctx, { media_renditions: createMediaRenditionsHandler(dir) })
    const files = readdirSync(join(dir, 'renditions')).sort()
    expect(files).toEqual(widthsFor(700).flatMap((w) => [`${up.media.id}-${w}.avif`, `${up.media.id}-${w}.webp`]).sort())
    const got = getMedia(s.ctx, up.media.id)
    expect(got.media.status).toBe('ready')
    expect(got.media.placeholder).toMatch(/^data:image\/webp;base64,/)
    expect(got.media.dominantColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(got.renditions).toHaveLength(files.length)
    expect(listMedia(s.ctx, { search: 'puppy', page: 1, pageSize: 10 }).total).toBe(1)
  })

  it('rejects files that are not supported images, whatever they are called', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    await expectCode(uploadMedia(s.ctx, s.editor, { filename: 'x.jpg', data: Buffer.from('<html>hello</html>'), mediaDir: dir }), 'validation_failed')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')
    await expectCode(uploadMedia(s.ctx, s.editor, { filename: 'logo.png', data: svg, mediaDir: dir }), 'validation_failed')
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer()
    await expectCode(uploadMedia(s.ctx, s.editor, { filename: 'a.gif', data: gif, mediaDir: dir }), 'validation_failed')
  })

  it('edits alt text, approves crops, and refuses to bin images on live pages', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    const { media } = await uploadMedia(s.ctx, s.editor, { filename: 'hero.jpg', data: await photo(1600, 900), mediaDir: dir })
    const handlers = { media_renditions: createMediaRenditionsHandler(dir), publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }
    await runJobsOnce(s.ctx, handlers)
    expect(updateMedia(s.ctx, s.editor, media.id, { alt: 'A volunteer walking two dogs' }).alt).toBe('A volunteer walking two dogs')

    await expectCode(() => approveCrop(s.ctx, s.editor, media.id, { ratio: '1:1', rect: { x: 1000, y: 0, width: 900, height: 900 } }), 'validation_failed')
    await expectCode(() => approveCrop(s.ctx, s.editor, media.id, { ratio: '1:1', rect: { x: 0, y: 0, width: 800, height: 400 } }), 'validation_failed')
    approveCrop(s.ctx, s.editor, media.id, { ratio: '1:1', rect: { x: 350, y: 0, width: 900, height: 900 } })
    await runJobsOnce(s.ctx, handlers)
    expect(existsSync(join(dir, 'renditions', `${media.id}-1x1-640.webp`))).toBe(true)
    expect(getMedia(s.ctx, media.id).crops[0]!.renditions).toContain(`${media.id}-1x1-900.avif`)

    const { page } = createPage(s.ctx, s.editor, { title: 'Adopt', template: 'standard' })
    applyPageOps(s.ctx, s.editor, page.id, 0, [{ op: 'add_block', block: { type: 'Image', props: { image: { media: media.id, alt: 'A volunteer walking two dogs' } } } }, { op: 'set_seo', description: 'Adopt a dog' }])
    expect(getMedia(s.ctx, media.id).usedOn).toEqual([{ pageId: page.id, title: 'Adopt', inDraft: true, live: false }])
    const sub = submitPage(s.ctx, s.editor, page.id)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    await expectCode(() => binMedia(s.ctx, s.approver, media.id), 'invalid_state')
    await expectCode(() => binMedia(s.ctx, s.editor, media.id), 'forbidden')
  })
})

describe('rendition widths', () => {
  it('never upscales and keeps the original width', () => {
    expect(widthsFor(200)).toEqual([200])
    expect(widthsFor(900)).toEqual([320, 640, 900])
    expect(widthsFor(1280)).toEqual([320, 640, 960, 1280])
    expect(widthsFor(6000)).toEqual([320, 640, 960, 1280, 1920, 2560])
  })
})
