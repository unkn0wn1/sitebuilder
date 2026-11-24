import { rejectPluginProposal } from '../../../../services/plugins/lifecycle'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  return rejectPluginProposal(ctx, actor, param(event, 'id'))
})
