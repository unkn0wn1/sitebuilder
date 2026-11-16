import { getSettings } from '../../../services/settings'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'settings.manage')
  return getSettings(ctx)
})
