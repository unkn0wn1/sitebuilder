import { listTemplateVersions } from '../../../../services/templates'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'template.read')
  return { items: listTemplateVersions(ctx, param(event, 'id')) }
})
