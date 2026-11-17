import { getBrand } from '../../../services/brand'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'brand.edit')
  return getBrand(ctx)
})
