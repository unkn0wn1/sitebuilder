import { getTemplate } from '../../../../services/templates'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'template.read')
  return getTemplate(ctx, param(event, 'id'))
})
