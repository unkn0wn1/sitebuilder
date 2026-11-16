import { listBin } from '../../../../services/pages'
import { defineApi, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.restoreFromBin')
  return { items: listBin(ctx) }
})
