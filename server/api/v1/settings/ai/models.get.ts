import { listXaiModels } from '../../../../services/ai-models'
import { defineApi, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  requireCan(event, 'settings.manage')
  return listXaiModels(ctx)
})
