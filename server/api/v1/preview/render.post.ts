import { z } from 'zod'
import { renderDraftPreview } from '../../../services/draft-preview'
import { PageMigrationError } from '../../../../shared/page'
import { AppError } from '../../../services/errors'
import { defineApi, parseBody, requireCan } from '../../../utils/api'

// Draw a draft page with the publish renderer, for the editor canvas and the approval preview.
const schema = z.object({ doc: z.unknown(), pageId: z.string().max(64).optional(), path: z.string().max(400).optional() })

export default defineApi(async (event, ctx) => {
  requireCan(event, 'page.read')
  const body = await parseBody(event, schema)
  try {
    return await renderDraftPreview(ctx, body.doc, { pageId: body.pageId, path: body.path })
  } catch (error) {
    if (error instanceof PageMigrationError) throw new AppError('validation_failed', error.message)
    throw error
  }
})
