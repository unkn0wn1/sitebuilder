import { z } from 'zod'
import { REVIEW_STATES } from '../../../../shared/workflow'
import { listReviews } from '../../../services/reviews'
import { defineApi, parseQuery, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  const { state } = parseQuery(event, z.object({ state: z.enum(REVIEW_STATES).optional() }))
  return { items: listReviews(ctx, actor, state) }
})
