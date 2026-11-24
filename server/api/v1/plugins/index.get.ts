import { listPlugins } from '../../../services/plugins/lifecycle'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  return listPlugins(ctx, actor)
})
