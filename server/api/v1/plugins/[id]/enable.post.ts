import { enablePlugin } from '../../../../services/plugins/lifecycle'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  return enablePlugin(ctx, actor, param(event, 'id'))
})
