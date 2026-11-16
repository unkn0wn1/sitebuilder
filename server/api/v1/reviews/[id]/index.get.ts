import { getReview } from '../../../../services/reviews'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => getReview(ctx, requireActor(event), param(event, 'id')))
