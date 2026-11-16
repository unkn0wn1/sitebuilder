import { getRequestHeader, readMultipartFormData } from 'h3'
import { AppError } from '../../../services/errors'
import { MEDIA_MAX_BYTES, uploadMedia } from '../../../services/media'
import { defineApi, requireCan } from '../../../utils/api'
import { mediaDir } from '../../../utils/state'

// Multipart upload with one "file" field. The type is checked from the file's content, not its name.
export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'media.upload')
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (length > MEDIA_MAX_BYTES + 64 * 1024) throw new AppError('validation_failed', 'That file is too big. The limit is 25 MB.', [{ path: 'file', message: 'Too big.' }])
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.filename)
  if (!file) throw new AppError('validation_failed', 'Choose an image to upload.', [{ path: 'file', message: 'Needed.' }])
  return uploadMedia(ctx, actor, { filename: file.filename!, data: file.data, mediaDir: mediaDir() })
})
