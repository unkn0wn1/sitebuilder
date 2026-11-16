import { listSiteParts } from '../../../services/site-parts'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return { items: listSiteParts(ctx) }
})
