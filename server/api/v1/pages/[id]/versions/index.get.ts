import { listVersions } from '../../../../../services/pages'
import { defineApi, param, requireCan } from '../../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return { items: listVersions(ctx, param(event, 'id')) }
})
