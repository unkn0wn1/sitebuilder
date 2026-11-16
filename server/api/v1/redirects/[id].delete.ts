import { deleteRedirect } from '../../../services/redirects'
import { defineApi, param, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  deleteRedirect(ctx, requireActor(event), param(event, 'id'))
  return { ok: true }
})
