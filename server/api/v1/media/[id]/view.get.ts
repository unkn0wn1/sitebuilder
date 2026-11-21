import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getQuery, getRequestHeader, sendStream, setResponseHeader, setResponseStatus } from 'h3'
import { notFound } from '../../../../services/errors'
import { getMedia, mediaPaths, pickRendition } from '../../../../services/media'
import { defineApi, param, requireCan } from '../../../../utils/api'
import { mediaDir } from '../../../../utils/state'
import { SVG_CSP } from '../../../../../shared/svg-sanitize'

// A photo for the builder's canvas and review previews: the nearest rendition that exists, using the approved crop
// for ?ratio= when there is one. Revalidated on every view so a new crop shows straight away.
export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  const id = param(event, 'id')
  const q = getQuery(event)
  const want = Math.max(16, Math.min(4096, Number(q.w) || 960))
  const ratio = typeof q.ratio === 'string' ? q.ratio : ''
  const { renditions, crops } = getMedia(ctx, id)
  const crop = ratio ? crops.find((c) => c.ratio === ratio && c.breakpoint === 'all') ?? crops.find((c) => c.ratio === ratio) : undefined
  const dir = mediaPaths(mediaDir()).renditions
  const exists = (n: string) => existsSync(join(dir, n))
  // A crop whose files are still being made falls back to the whole photo.
  const name = (crop && pickRendition(crop.renditions.filter(exists), want)) || pickRendition(renditions.filter(exists), want)
  if (!name) throw notFound('That photo')
  const file = join(dir, name)
  const st = statSync(file)
  const etag = `"${name}-${st.size}-${Math.floor(st.mtimeMs)}"`
  setResponseHeader(event, 'cache-control', 'private, no-cache')
  setResponseHeader(event, 'etag', etag)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return undefined
  }
  const type = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.webm') ? 'video/webm' : 'image/webp'
  setResponseHeader(event, 'content-type', type)
  if (name.endsWith('.svg')) setResponseHeader(event, 'content-security-policy', SVG_CSP)
  return sendStream(event, createReadStream(file))
})
