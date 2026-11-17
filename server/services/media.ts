// Media library: upload, renditions at upload time with sharp, alt text, crops, usage, bin.
// See docs/05-image-pipeline.md and ADR 0013.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm'
import sharp, { type Metadata } from 'sharp'
import { z } from 'zod'
import { cropRectError, defaultCropRect, type CropRect } from '../../shared/crop'
import { newId } from '../../shared/ids'
import { zodIssues } from '../../shared/issues'
import { can } from '../../shared/roles'
import { media, mediaCrops, pages, versions } from '../db/schema'
import { audit } from './audit'
import { inTx, iso, type ActingAs, type ServiceCtx } from './context'
import { AppError, forbidden, notFound } from './errors'
import { enqueueJob, type JobHandler } from './jobs'

export const MEDIA_MAX_BYTES = 25 * 1024 * 1024
/** Prepared looping hero videos (transcoding is later). A few megabytes, with a little headroom. */
export const VIDEO_MAX_BYTES = 8 * 1024 * 1024
export const MEDIA_MAX_PIXELS = 100_000_000
export const RENDITION_WIDTHS = [320, 640, 960, 1280, 1920, 2560] as const
export const RENDITION_FORMATS = ['avif', 'webp'] as const

const FORMATS: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  avif: { ext: 'avif', mime: 'image/avif' },
}

export type MediaRow = typeof media.$inferSelect

export const mediaPaths = (dir: string) => ({ originals: join(dir, 'originals'), renditions: join(dir, 'renditions') })

const VIDEO_TYPES: Record<string, { ext: string; mime: string }> = {
  'video/mp4': { ext: 'mp4', mime: 'video/mp4' },
  'video/webm': { ext: 'webm', mime: 'video/webm' },
}

export function looksLikeVideo(data: Buffer): { mime: string; ext: string } | null {
  if (data.length >= 8 && data.subarray(4, 8).toString('ascii') === 'ftyp') return VIDEO_TYPES['video/mp4']!
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return VIDEO_TYPES['video/webm']!
  return null
}

function masterPath(dir: string, row: Pick<MediaRow, 'id' | 'mime'>) {
  const ext = Object.values(FORMATS).find((f) => f.mime === row.mime)?.ext ?? VIDEO_TYPES[row.mime]?.ext ?? 'bin'
  return join(mediaPaths(dir).originals, `${row.id}.${ext}`)
}

/** Public filename of a prepared video, served from /media/ next to image renditions. */
export function videoPublicName(row: Pick<MediaRow, 'id' | 'mime'>): string {
  const ext = VIDEO_TYPES[row.mime]?.ext ?? 'mp4'
  return `${row.id}.${ext}`
}

/** Widths to make: the standard set up to the original's width, plus the original width itself so no detail is lost. */
export function widthsFor(width: number): number[] {
  const ws: number[] = RENDITION_WIDTHS.filter((w) => w <= width)
  if (width > 0 && width < RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1]! && !ws.includes(width)) ws.push(width)
  return ws
}

export const ratioKey = (ratio: string) => ratio.replace(':', 'x')

/** File names of the renditions for an image (and its crops). Served from /media/ on the public site. */
export function renditionNames(row: Pick<MediaRow, 'id' | 'width'>, cropRatio?: string): string[] {
  const base = cropRatio ? `${row.id}-${ratioKey(cropRatio)}` : row.id
  return widthsFor(row.width ?? 0).flatMap((w) => RENDITION_FORMATS.map((f) => `${base}-${w}.${f}`))
}

function requireMedia(ctx: ServiceCtx, id: string): MediaRow {
  const row = ctx.db.select().from(media).where(and(eq(media.id, id), eq(media.siteId, ctx.siteId))).get()
  if (!row || row.deletedAt) throw notFound('That image')
  return row
}

export async function uploadMedia(ctx: ServiceCtx, actor: ActingAs, input: { filename: string; data: Buffer; mediaDir: string }) {
  if (actor.aiSessionId || !can(actor, 'media.upload')) throw forbidden()
  if (!input.data.length) throw new AppError('validation_failed', 'That file is empty.', [{ path: 'file', message: 'Empty.' }])
  const videoType = looksLikeVideo(input.data)
  if (videoType) {
    if (input.data.length > VIDEO_MAX_BYTES) throw new AppError('validation_failed', 'That video is too big. Prepare it to under 8 MB before uploading.', [{ path: 'file', message: 'Too big.' }])
  } else if (input.data.length > MEDIA_MAX_BYTES) {
    throw new AppError('validation_failed', 'That file is too big. The limit is 25 MB.', [{ path: 'file', message: 'Too big.' }])
  }
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const dup = ctx.db.select().from(media).where(and(eq(media.siteId, ctx.siteId), eq(media.sha256, sha256), isNull(media.deletedAt))).get()
  if (dup) return { media: dup, duplicate: true, jobId: null }

  if (videoType) return uploadPreparedVideo(ctx, actor, input, videoType, sha256)

  let meta: Metadata
  try {
    meta = await sharp(input.data, { limitInputPixels: MEDIA_MAX_PIXELS }).metadata()
  } catch {
    throw new AppError('validation_failed', "We couldn't read that image. Use a JPEG, PNG, WebP or AVIF file.", [{ path: 'file', message: 'Not a supported image.' }])
  }
  // Detect the type from the file itself, never from its name or the browser's claim.
  const format = meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format
  const kind = format ? FORMATS[format] : undefined
  if (!kind) {
    const svg = meta.format === 'svg' ? ' SVG logos and icons are not supported yet.' : ''
    throw new AppError('validation_failed', `Use a JPEG, PNG, WebP or AVIF image.${svg}`, [{ path: 'file', message: 'Not a supported image type.' }])
  }
  if ((meta.pages ?? 1) > 1) throw new AppError('validation_failed', 'Animated images are not supported. Use a still image or a video.', [{ path: 'file', message: 'Animated.' }])

  // The stored master is rotated upright and has all metadata (including GPS location) removed.
  let pipeline = sharp(input.data, { limitInputPixels: MEDIA_MAX_PIXELS }).rotate()
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true })
  else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 })
  else if (format === 'webp') pipeline = pipeline.webp({ quality: 92 })
  else pipeline = pipeline.avif({ quality: 70 })
  const { data: master, info } = await pipeline.toBuffer({ resolveWithObject: true })

  const id = newId('media', ctx.now().getTime())
  const filename = input.filename.replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'image'
  const row: MediaRow = {
    id,
    siteId: ctx.siteId,
    kind: 'image',
    filename,
    mime: kind.mime,
    bytes: master.length,
    width: info.width,
    height: info.height,
    sha256,
    alt: null,
    decorative: false,
    focalX: null,
    focalY: null,
    placeholder: null,
    dominantColor: null,
    status: 'processing',
    uploadedBy: actor.id,
    createdAt: iso(ctx),
    deletedAt: null,
  }
  mkdirSync(mediaPaths(input.mediaDir).originals, { recursive: true })
  writeFileSync(masterPath(input.mediaDir, row), master)
  const jobId = inTx(ctx, () => {
    ctx.db.insert(media).values(row).run()
    audit(ctx, actor, 'media.uploaded', { type: 'media', id }, { filename, bytes: row.bytes, width: row.width, height: row.height })
    return enqueueJob(ctx, 'media_renditions', { mediaId: id }, { createdBy: actor.id })
  })
  return { media: row, duplicate: false, jobId }
}


function uploadPreparedVideo(ctx: ServiceCtx, actor: ActingAs, input: { filename: string; data: Buffer; mediaDir: string }, type: { ext: string; mime: string }, sha256: string) {
  const id = newId('media', ctx.now().getTime())
  const filename = input.filename.replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'video'
  const row: MediaRow = {
    id,
    siteId: ctx.siteId,
    kind: 'video',
    filename,
    mime: type.mime,
    bytes: input.data.length,
    width: null,
    height: null,
    sha256,
    alt: null,
    decorative: false,
    focalX: null,
    focalY: null,
    placeholder: null,
    dominantColor: null,
    status: 'ready',
    uploadedBy: actor.id,
    createdAt: iso(ctx),
    deletedAt: null,
  }
  const paths = mediaPaths(input.mediaDir)
  mkdirSync(paths.originals, { recursive: true })
  mkdirSync(paths.renditions, { recursive: true })
  writeFileSync(masterPath(input.mediaDir, row), input.data)
  writeFileSync(join(paths.renditions, videoPublicName(row)), input.data)
  inTx(ctx, () => {
    ctx.db.insert(media).values(row).run()
    audit(ctx, actor, 'media.uploaded', { type: 'media', id }, { filename, bytes: row.bytes, kind: 'video' })
  })
  return { media: row, duplicate: false, jobId: null }
}

/** The media_renditions job: AVIF and WebP at the standard widths, plus placeholder and colour, or one crop's set. */
export function createMediaRenditionsHandler(mediaDir: string): JobHandler {
  return {
    async run(ctx, job) {
      const { mediaId, cropId } = job.payload as { mediaId: string; cropId?: string }
      const row = ctx.db.select().from(media).where(eq(media.id, mediaId)).get()
      if (!row || row.deletedAt) return { skipped: 'Image was deleted.' }
      const crop = cropId ? ctx.db.select().from(mediaCrops).where(eq(mediaCrops.id, cropId)).get() : undefined
      const source = readFileSync(masterPath(mediaDir, row))
      const out = mediaPaths(mediaDir).renditions
      mkdirSync(out, { recursive: true })
      const width = crop ? crop.width : (row.width ?? 0)
      const base = crop ? `${row.id}-${ratioKey(crop.ratio)}` : row.id
      let files = 0
      for (const w of widthsFor(width)) {
        let img = sharp(source, { limitInputPixels: MEDIA_MAX_PIXELS })
        if (crop) img = img.extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
        img = img.resize({ width: w, withoutEnlargement: true })
        await img.clone().avif({ quality: 55, effort: 4 }).toFile(join(out, `${base}-${w}.avif`))
        await img.clone().webp({ quality: 78 }).toFile(join(out, `${base}-${w}.webp`))
        files += 2
      }
      if (!crop) {
        const tiny = await sharp(source).resize({ width: 16 }).webp({ quality: 40 }).toBuffer()
        const { dominant } = await sharp(source).stats()
        const hex = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
        ctx.db.update(media).set({ status: 'ready', placeholder: `data:image/webp;base64,${tiny.toString('base64')}`, dominantColor: hex }).where(eq(media.id, row.id)).run()
      }
      return { files }
    },
    onFinalFailure(ctx, job) {
      const { mediaId, cropId } = job.payload as { mediaId: string; cropId?: string }
      if (!cropId) ctx.db.update(media).set({ status: 'failed' }).where(eq(media.id, mediaId)).run()
    },
  }
}

export function listMedia(ctx: ServiceCtx, q: { search?: string; page: number; pageSize: number }) {
  const where = and(eq(media.siteId, ctx.siteId), isNull(media.deletedAt), q.search ? or(like(media.filename, `%${q.search}%`), like(media.alt, `%${q.search}%`)) : undefined)
  const total = ctx.db.select({ n: sql<number>`count(*)` }).from(media).where(where).get()?.n ?? 0
  const items = ctx.db.select().from(media).where(where).orderBy(desc(media.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all()
  return { items, page: q.page, pageSize: q.pageSize, total }
}

/** Pages whose draft or live version uses an image. */
export function mediaUsage(ctx: ServiceCtx, mediaId: string) {
  const rows = ctx.db
    .select({ id: pages.id, title: pages.title, draft: pages.draftVersionId, live: pages.publishedVersionId })
    .from(pages)
    .where(and(eq(pages.siteId, ctx.siteId), isNull(pages.deletedAt)))
    .all()
  const used: { pageId: string; title: string; inDraft: boolean; live: boolean }[] = []
  const docHas = (versionId: string | null) => {
    if (!versionId) return false
    const v = ctx.db.select({ doc: versions.doc }).from(versions).where(eq(versions.id, versionId)).get()
    return !!v && JSON.stringify(v.doc).includes(`"${mediaId}"`)
  }
  for (const r of rows) {
    const inDraft = docHas(r.draft)
    const live = r.live === r.draft ? inDraft : docHas(r.live)
    if (inDraft || live) used.push({ pageId: r.id, title: r.title, inDraft, live })
  }
  return used
}

export function getMedia(ctx: ServiceCtx, id: string) {
  const row = requireMedia(ctx, id)
  const crops = ctx.db.select().from(mediaCrops).where(eq(mediaCrops.mediaId, id)).all()
  return {
    media: row,
    renditions: row.status === 'ready' ? (row.kind === 'video' ? [videoPublicName(row)] : renditionNames(row)) : [],
    crops: crops.map((c) => ({ ...c, renditions: renditionNames({ id: row.id, width: c.width }, c.ratio) })),
    usedOn: mediaUsage(ctx, id),
  }
}

export const mediaPatchSchema = z
  .object({
    alt: z.string().trim().max(250, { message: 'Keep alt text under 250 characters.' }).nullable().optional(),
    decorative: z.boolean().optional(),
    focalX: z.number().int().min(0).max(100).nullable().optional(),
    focalY: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict()

export function updateMedia(ctx: ServiceCtx, actor: ActingAs, id: string, patch: z.infer<typeof mediaPatchSchema>) {
  if (!can(actor, 'media.upload')) throw forbidden()
  requireMedia(ctx, id)
  ctx.db.update(media).set(patch).where(eq(media.id, id)).run()
  audit(ctx, actor, 'media.updated', { type: 'media', id }, { fields: Object.keys(patch) })
  return requireMedia(ctx, id)
}

export const cropInputSchema = z.object({
  ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/, { message: 'Use a ratio like 16:9.' }),
  breakpoint: z.enum(['all', 'mobile', 'desktop']).default('all'),
  rect: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(16), height: z.number().int().min(16) }).strict(),
})

export interface ResolvedCrop {
  media: MediaRow
  ratio: string
  breakpoint: 'all' | 'mobile' | 'desktop'
  rect: CropRect
}

/** Validate a crop (or fill in a centred default) without approving it. */
export function resolveCrop(ctx: ServiceCtx, id: string, input: { ratio: string; breakpoint?: 'all' | 'mobile' | 'desktop'; rect?: CropRect }): ResolvedCrop {
  const row = requireMedia(ctx, id)
  if (row.kind !== 'image') throw new AppError('validation_failed', 'Only still images can be cropped.', [{ path: 'mediaId', message: 'Not an image.' }])
  const width = row.width ?? 0
  const height = row.height ?? 0
  if (width < 16 || height < 16) throw new AppError('validation_failed', "This image isn't large enough to crop.", [{ path: 'mediaId', message: 'Too small.' }])
  const rect = input.rect ?? defaultCropRect({ width, height, focalX: row.focalX, focalY: row.focalY }, input.ratio)
  const result = cropInputSchema.safeParse({ ratio: input.ratio, breakpoint: input.breakpoint ?? 'all', rect })
  if (!result.success) throw new AppError('validation_failed', result.error.issues[0]!.message, zodIssues(result.error))
  const parsed = result.data
  const err = cropRectError({ width, height }, parsed.ratio, parsed.rect)
  if (err) throw new AppError('validation_failed', err, [{ path: 'rect', message: err }])
  return { media: row, ratio: parsed.ratio, breakpoint: parsed.breakpoint, rect: parsed.rect }
}

/** Approve a crop for a slot ratio. Coordinates are against the stored (upright) image. The assistant cannot approve. */
export function approveCrop(ctx: ServiceCtx, actor: ActingAs, id: string, input: z.input<typeof cropInputSchema>) {
  if (actor.aiSessionId) throw forbidden('The assistant can propose a crop, but a person has to approve it.')
  if (!can(actor, 'media.upload')) throw forbidden()
  const { media: row, ratio, breakpoint, rect } = resolveCrop(ctx, id, input)
  return inTx(ctx, () => {
    ctx.db.delete(mediaCrops).where(and(eq(mediaCrops.mediaId, id), eq(mediaCrops.ratio, ratio), eq(mediaCrops.breakpoint, breakpoint))).run()
    const cropId = newId('crop', ctx.now().getTime())
    ctx.db.insert(mediaCrops).values({ id: cropId, siteId: ctx.siteId, mediaId: id, ratio, breakpoint, x: rect.x, y: rect.y, width: rect.width, height: rect.height, approvedBy: actor.id, approvedAt: iso(ctx) }).run()
    const jobId = enqueueJob(ctx, 'media_renditions', { mediaId: id, cropId }, { createdBy: actor.id })
    audit(ctx, actor, 'media.crop_approved', { type: 'media', id }, { cropId, ratio })
    return { cropId, jobId }
  })
}

/** Move an image to the bin. Refused while a live page uses it. Files stay until bin clean-up. */
export function binMedia(ctx: ServiceCtx, actor: ActingAs, id: string) {
  if (actor.aiSessionId || !can(actor, 'media.delete')) throw forbidden()
  requireMedia(ctx, id)
  const live = mediaUsage(ctx, id).filter((u) => u.live)
  if (live.length) throw new AppError('invalid_state', `This image is on live pages: ${live.map((u) => u.title).join(', ')}. Replace it there first.`)
  ctx.db.update(media).set({ deletedAt: iso(ctx) }).where(eq(media.id, id)).run()
  audit(ctx, actor, 'media.binned', { type: 'media', id })
}
