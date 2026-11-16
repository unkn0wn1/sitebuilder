import { z } from 'zod'
import { approveReview } from '../../../../services/reviews'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

const schema = z.object({ versionId: z.string().min(1).max(64), overrideReason: z.string().trim().min(5).max(500).optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return approveReview(ctx, actor, param(event, 'id'), await parseBody(event, schema))
})
