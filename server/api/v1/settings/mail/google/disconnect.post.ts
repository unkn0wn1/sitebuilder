import { disconnectGoogle } from '../../../../../services/gmail'
import { defineApi, requireCan } from '../../../../../utils/api'

export default defineApi((event, ctx) => {
  disconnectGoogle(ctx, requireCan(event, 'settings.manage'))
  return { ok: true }
})
