import { changeForReview } from '../../../../services/agent/admin'
import { defineApi, param, requireActor } from '../../../../utils/api'

// The agent change this review is part of (if any), so the approval screen can offer to approve all of it.
export default defineApi((event, ctx) => changeForReview(ctx, requireActor(event), param(event, 'id')))
