import { getSoul } from '../../../../services/soul'
import { defineApi, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  requireCan(event, 'settings.manage')
  return getSoul(ctx)
})
