import { testAiConnection } from '../../../../services/ai-loop'
import { defineApi, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  requireCan(event, 'settings.manage')
  return testAiConnection(ctx)
})
