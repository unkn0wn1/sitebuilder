import { z } from 'zod'
import { sendBackReview } from '../../../../services/reviews'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { comment } = await parseBody(event, z.object({ comment: z.string().trim().min(1).max(2000) }))
  return sendBackReview(ctx, actor, param(event, 'id'), comment)
})
