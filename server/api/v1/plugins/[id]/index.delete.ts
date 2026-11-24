import { uninstallPlugin } from '../../../../services/plugins/lifecycle'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  return uninstallPlugin(ctx, actor, param(event, 'id'))
})
