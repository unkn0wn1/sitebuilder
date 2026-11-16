import { listTemplates } from '../../../services/templates'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'template.read')
  return { items: listTemplates(ctx) }
})
