import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sendStream, setResponseHeader } from 'h3'
import { notFound } from '../../../../../services/errors'
import { getMedia, mediaPaths } from '../../../../../services/media'
import { defineApi, param, requireCan } from '../../../../../utils/api'
import { mediaDir } from '../../../../../utils/state'
import { SVG_CSP } from '../../../../../../shared/svg-sanitize'

// Renditions for previews inside the builder (signed-in users only). The public site serves its own copies.
export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  const id = param(event, 'id')
  const name = param(event, 'name')
  const { renditions, crops } = getMedia(ctx, id)
  if (![...renditions, ...crops.flatMap((c) => c.renditions)].includes(name)) throw notFound('That file')
  const file = join(mediaPaths(mediaDir()).renditions, name)
  if (!existsSync(file)) throw notFound('That file')
  const type = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.avif') ? 'image/avif' : name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.webm') ? 'video/webm' : 'image/webp'
  setResponseHeader(event, 'content-type', type)
  setResponseHeader(event, 'cache-control', 'private, max-age=86400')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  if (name.endsWith('.svg')) setResponseHeader(event, 'content-security-policy', SVG_CSP)
  return sendStream(event, createReadStream(file))
})
