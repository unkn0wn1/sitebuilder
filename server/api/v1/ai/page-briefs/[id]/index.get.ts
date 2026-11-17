import { getPageBrief } from '../../../../../services/page-brief'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  return getPageBrief(ctx, actor, param(event, 'id'))
})
