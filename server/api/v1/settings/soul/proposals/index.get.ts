import { listSoulProposals } from '../../../../../services/soul-proposals'
import { defineApi, requireCan } from '../../../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  return listSoulProposals(ctx, actor)
})
