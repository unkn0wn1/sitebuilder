import { z } from 'zod'
import { addReviewComment } from '../../../../services/reviews'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { body, blockId } = await parseBody(event, z.object({ body: z.string().trim().min(1).max(2000), blockId: z.string().max(32).optional() }))
  return addReviewComment(ctx, actor, param(event, 'id'), body, blockId)
})
