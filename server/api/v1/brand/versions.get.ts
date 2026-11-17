import { listBrandVersions } from '../../../services/brand'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'brand.edit')
  return { items: listBrandVersions(ctx) }
})
