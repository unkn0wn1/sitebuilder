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
import { editBrand, submitBrand } from '../server/services/brand'
import { defaultBrandDoc } from '../shared/brand'
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
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer()
    await expectCode(uploadMedia(s.ctx, s.editor, { filename: 'a.gif', data: gif, mediaDir: dir }), 'validation_failed')
  })

  it('accepts a sanitised SVG, stores it as svg, and lists it with images', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    const dirty = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><script>alert(1)</script><circle r="8" fill="#0a7" onclick="alert(1)"/></svg>')
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'candid-seal.svg', data: dirty, mediaDir: dir })
    expect(up.media.kind).toBe('svg')
    expect(up.media.mime).toBe('image/svg+xml')
    const stored = readFileSync(join(dir, 'originals', `${up.media.id}.svg`), 'utf8')
    expect(stored).toContain('<circle')
    expect(stored).not.toMatch(/script/i)
    expect(stored).not.toMatch(/onclick/i)
    expect(existsSync(join(dir, 'renditions', `${up.media.id}.svg`))).toBe(true)

    await runJobsOnce(s.ctx, { media_renditions: createMediaRenditionsHandler(dir) })
    const got = getMedia(s.ctx, up.media.id)
    expect(got.media.status).toBe('ready')
    expect(got.preview).toBe(`${up.media.id}.svg`)
    expect(got.renditions).toContain(`${up.media.id}.svg`)
    expect(got.renditions.some((n) => n.endsWith('.webp'))).toBe(true)
    expect(listMedia(s.ctx, { kind: 'image', page: 1, pageSize: 10 }).items.map((i) => i.id)).toContain(up.media.id)
    expect(listMedia(s.ctx, { kind: 'video', page: 1, pageSize: 10 }).total).toBe(0)
    s.sqlite.close()
  })

  it('edits alt text, approves crops, and refuses to bin images on live pages', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    const { media } = await uploadMedia(s.ctx, s.editor, { filename: 'hero.jpg', data: await photo(1600, 900), mediaDir: dir })
    const handlers = { media_renditions: createMediaRenditionsHandler(dir), publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }
    await runJobsOnce(s.ctx, handlers)
    expect(updateMedia(s.ctx, s.editor, media.id, { alt: 'A volunteer walking two dogs' }).alt).toBe('A volunteer walking two dogs')
    expect(updateMedia(s.ctx, s.editor, media.id, { focalX: 200, focalY: 100 }).focalX).toBe(200)
    await expectCode(() => updateMedia(s.ctx, s.editor, media.id, { focalX: 2000 }), 'validation_failed')

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

function fakeMp4(): Buffer {
  const data = Buffer.alloc(64)
  data.writeUInt32BE(64, 0)
  data.write('ftypisom', 4)
  return data
}

describe('prepared video uploads', () => {
  it('accepts a prepared MP4 under the size limit and serves it next to renditions', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sitebuilder-media-'))
    const up = await uploadMedia(s.ctx, s.editor, { filename: 'hero.mp4', data: fakeMp4(), mediaDir: dir })
    expect(up.media.kind).toBe('video')
    expect(up.media.status).toBe('ready')
    expect(up.jobId).toBeNull()
    const got = getMedia(s.ctx, up.media.id)
    expect(got.renditions).toEqual([`${up.media.id}.mp4`])
    expect(existsSync(join(dir, 'originals', `${up.media.id}.mp4`))).toBe(true)
    expect(existsSync(join(dir, 'renditions', `${up.media.id}.mp4`))).toBe(true)
  })

  it('refuses an oversized video', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sitebuilder-media-'))
    const data = Buffer.alloc(8 * 1024 * 1024 + 8)
    data.writeUInt32BE(data.length, 0)
    data.write('ftypisom', 4)
    await expectCode(uploadMedia(s.ctx, s.editor, { filename: 'huge.mp4', data, mediaDir: dir }), 'validation_failed')
  })
})


describe('brand logo usage', () => {
  it('lists Brand and Design as a use, and refuses to bin a live logo', async () => {
    const s = setup()
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'))
    const { media } = await uploadMedia(s.ctx, s.admin, {
      filename: 'logo.png',
      data: await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 200, g: 80, b: 20, alpha: 1 } } }).png().toBuffer(),
      mediaDir: dir,
    })
    const handlers = { media_renditions: createMediaRenditionsHandler(dir), publish: createPublishHandler(), purge_cache: { run: () => ({}) }, send_email: { run: () => ({}) } }
    await runJobsOnce(s.ctx, handlers)
    const dark = await uploadMedia(s.ctx, s.admin, {
      filename: 'logo-dark.png',
      data: await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(),
      mediaDir: dir,
    })
    editBrand(s.ctx, s.admin, 0, { ...defaultBrandDoc(), logoMediaId: media.id, logoDarkMediaId: dark.media.id })
    expect(getMedia(s.ctx, dark.media.id).usedOn).toEqual([
      { pageId: expect.any(String), title: 'Brand and Design', inDraft: true, live: false, href: '/brand' },
    ])
    expect(getMedia(s.ctx, media.id).usedOn).toEqual([
      { pageId: expect.any(String), title: 'Brand and Design', inDraft: true, live: false, href: '/brand' },
    ])
    const sub = submitBrand(s.ctx, s.admin)
    approveReview(s.ctx, s.approver, sub.reviewId, { versionId: sub.versionId })
    await runJobsOnce(s.ctx, handlers)
    expect(getMedia(s.ctx, media.id).usedOn.some((u) => u.title === 'Brand and Design' && u.live)).toBe(true)
    await expectCode(() => binMedia(s.ctx, s.approver, media.id), 'invalid_state')
  })
})
