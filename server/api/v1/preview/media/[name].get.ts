import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestHeader, sendStream, setResponseHeader, setResponseStatus } from 'h3'
import { notFound } from '../../../../services/errors'
import { mediaPaths } from '../../../../services/media'
import { defineApi, param, requireCan } from '../../../../utils/api'
import { mediaDir } from '../../../../utils/state'
import { SVG_CSP } from '../../../../../shared/svg-sanitize'

const TYPES: Record<string, string> = { webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg', png: 'image/png' }

// A rendition file by its published name (/media/<name> on the public site), for builder previews.
export default defineApi((event) => {
  requireCan(event, 'page.read')
  const name = param(event, 'name')
  const ext = /^med_[0-9A-Za-z]{26}(?:-[0-9A-Za-z]+)*\.([a-z0-9]+)$/.exec(name)?.[1]
  if (!ext || !TYPES[ext]) throw notFound('That file')
  const file = join(mediaPaths(mediaDir()).renditions, name)
  if (!existsSync(file)) throw notFound('That file')
  const st = statSync(file)
  const etag = `"${name}-${st.size}-${Math.floor(st.mtimeMs)}"`
  setResponseHeader(event, 'cache-control', 'private, no-cache')
  setResponseHeader(event, 'etag', etag)
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return undefined
  }
  setResponseHeader(event, 'content-type', TYPES[ext]!)
  if (ext === 'svg') setResponseHeader(event, 'content-security-policy', SVG_CSP)
  return sendStream(event, createReadStream(file))
})
