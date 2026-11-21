import { z } from 'zod'
import { addSitePart } from '../../../services/site-parts'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

// Add a menu or a top strip from the builder (neither is live until approved).
const schema = z.object({ kind: z.enum(['menu', 'banner']), label: z.string().trim().min(1).max(60) })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return addSitePart(ctx, actor, await parseBody(event, schema))
})
