import { listRedirects } from '../../../services/redirects'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'redirect.manage')
  return { items: listRedirects(ctx) }
})
