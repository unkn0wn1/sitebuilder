// Favicon and apple-touch icons, generated from the published brand logo.
// A wide wordmark is cropped to the left-hand mark so the small icon stays legible.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { SiteRenderContext } from './render'
import { masterPath, mediaPaths, type MediaRow } from './media'
import { media as mediaTable } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceCtx } from './context'

export const BRAND_ICON_FILES = ['favicon.png', 'apple-touch-icon.png'] as const

export interface BrandIconFiles {
  favicon: Buffer
  appleTouch: Buffer
}

/** Cut a square mark from a logo, preferring the left-hand symbol on a wide wordmark. */
export async function squareMarkFromLogo(source: Buffer, size = 512): Promise<Buffer> {
  const { data, info } = await sharp(source, { limitInputPixels: 100_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const channels = info.channels ?? 4
  const opaque: boolean[] = new Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const a = data[i * channels + 3] ?? 255
    const r = data[i * channels] ?? 255
    const g = data[i * channels + 1] ?? 255
    const b = data[i * channels + 2] ?? 255
    const nearWhite = r >= 250 && g >= 250 && b >= 250
    const on = a >= 16 && !nearWhite
    opaque[i] = on
  }
  // Logos without an alpha channel still key out a near-white studio background.
  const use = opaque
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!use[y * width + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) {
    // Empty or fully white: pad the whole canvas into a square.
    return sharp(source).ensureAlpha().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  }

  let markLeft = minX
  let markTop = minY
  let markW = maxX - minX + 1
  let markH = maxY - minY + 1
  if (markW / markH > 1.35) {
    // First low-density column gap inside the content, then only the left-hand mark.
    const colCounts = new Array(width).fill(0)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (use[y * width + x]) colCounts[x]++
      }
    }
    const threshold = Math.max(2, Math.floor(markH * 0.01))
    let gapStart: number | null = null
    let markRight = maxX
    for (let x = minX; x <= maxX; x++) {
      if (colCounts[x] <= threshold) {
        if (gapStart === null) gapStart = x
      } else if (gapStart !== null) {
        if (x - gapStart >= 8 && gapStart - minX >= markH * 0.5) {
          markRight = gapStart - 1
          break
        }
        gapStart = null
      }
    }
    markW = Math.max(1, markRight - minX + 1)
    markH = maxY - minY + 1
    markLeft = minX
    markTop = minY
  }

  // Extract only the mark, then letterbox it on a transparent square so padding
  // cannot pull neighbouring wordmark letters into the icon.
  const mark = await sharp(source)
    .ensureAlpha()
    .extract({ left: markLeft, top: markTop, width: markW, height: markH })
    .png()
    .toBuffer()
  const pad = Math.max(2, Math.round(size * 0.08))
  const inner = Math.max(1, size - pad * 2)
  return sharp(mark)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}


async function readLogoSource(mediaDir: string, row: Pick<MediaRow, 'id' | 'mime'>): Promise<Buffer | null> {
  const master = masterPath(mediaDir, row)
  if (existsSync(master)) return readFileSync(master)
  const renditions = mediaPaths(mediaDir).renditions
  if (!existsSync(renditions)) return null
  const names = readdirSync(renditions)
    .filter((n) => n.startsWith(`${row.id}-`) && (n.endsWith('.webp') || n.endsWith('.png')))
    .sort()
  const last = names.at(-1)
  return last ? readFileSync(join(renditions, last)) : null
}

/** Build 32×32 and 180×180 PNGs from the site's published brand logo, or null when there isn't one. */
export async function buildBrandIcons(ctx: ServiceCtx | null, site: SiteRenderContext, mediaDir: string | undefined): Promise<BrandIconFiles | null> {
  const id = site.brand?.logoMediaId
  if (!id || !site.media[id] || !mediaDir) return null
  let mime = site.media[id].mime
  if (ctx) {
    const row = ctx.db.select({ id: mediaTable.id, mime: mediaTable.mime }).from(mediaTable).where(eq(mediaTable.id, id)).get()
    if (row) mime = row.mime
  }
  const source = await readLogoSource(mediaDir, { id, mime })
  if (!source) return null
  const mark = await squareMarkFromLogo(source, 512)
  const [favicon, appleTouch] = await Promise.all([
    sharp(mark).resize(32, 32).png().toBuffer(),
    sharp(mark).resize(180, 180).png().toBuffer(),
  ])
  return { favicon, appleTouch }
}
