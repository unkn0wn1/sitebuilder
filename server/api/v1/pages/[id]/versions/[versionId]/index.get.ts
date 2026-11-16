import { getVersion } from '../../../../../../services/pages'
import { defineApi, param, requireCan } from '../../../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return getVersion(ctx, param(event, 'id'), param(event, 'versionId'))
})
