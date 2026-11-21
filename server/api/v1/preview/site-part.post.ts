import { z } from 'zod'
import { renderSitePartPreview } from '../../../services/draft-preview'
import { defineApi, parseBody, requireCan } from '../../../utils/api'

// Draw a live page with draft site parts (header and top strip, a menu, or the footer) for the site-part editor.
const schema = z.object({
  parts: z.array(z.object({ partId: z.string().min(1).max(64), doc: z.unknown() })).min(1).max(4),
  pageId: z.string().max(64).optional(),
})

export default defineApi(async (event, ctx) => {
  requireCan(event, 'page.read')
  return renderSitePartPreview(ctx, await parseBody(event, schema))
})
