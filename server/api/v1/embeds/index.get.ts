import { listEmbeds } from '../../../services/site'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'embed.read')
  return { items: listEmbeds(ctx) }
})
