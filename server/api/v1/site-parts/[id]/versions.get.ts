import { listSitePartVersions } from '../../../../services/site-parts'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return { items: listSitePartVersions(ctx, param(event, 'id')) }
})
