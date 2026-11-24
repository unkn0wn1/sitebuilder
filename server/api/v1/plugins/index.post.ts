import { getRequestHeader, readMultipartFormData } from 'h3'
import { PLUGIN_ARCHIVE_MAX_BYTES } from '../../../../shared/plugins/limits'
import { AppError } from '../../../services/errors'
import { installPluginArchive } from '../../../services/plugins/install'
import { defineApi, requireCan } from '../../../utils/api'

// Multipart fields are "archive" and an optional "signature". Not the media field name "file".
export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  if (length > PLUGIN_ARCHIVE_MAX_BYTES + 64 * 1024) {
    throw new AppError('validation_failed', 'That archive is too big.', [{ path: 'archive', message: 'That archive is too big.' }])
  }
  const parts = await readMultipartFormData(event)
  const archive = parts?.find((part) => part.name === 'archive')
  if (!archive?.data?.length) throw new AppError('validation_failed', 'Choose a plugin archive.', [{ path: 'archive', message: 'Choose a .tar.gz file.' }])
  if (archive.data.length > PLUGIN_ARCHIVE_MAX_BYTES) {
    throw new AppError('validation_failed', 'That archive is too big.', [{ path: 'archive', message: 'That archive is too big.' }])
  }
  const signature = parts?.find((part) => part.name === 'signature')
  if (signature?.data && signature.data.length > 16 * 1024) {
    throw new AppError('validation_failed', 'That signature file is too big.', [{ path: 'signature', message: 'That signature file is too big.' }])
  }
  const signatureBytes = signature?.data?.length ? Buffer.from(signature.data) : null
  return installPluginArchive(ctx, actor, Buffer.from(archive.data), signatureBytes)
})
