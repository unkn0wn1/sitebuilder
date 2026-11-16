import { getSitePart } from '../../../../services/site-parts'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return getSitePart(ctx, param(event, 'id'))
})
