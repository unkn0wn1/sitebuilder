import { webhookView } from '../../../../services/agent/webhook'
import { defineApi, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'settings.manage')
  return webhookView(ctx)
})
