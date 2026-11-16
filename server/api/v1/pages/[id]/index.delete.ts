import { binPage } from '../../../../services/pages'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  binPage(ctx, requireActor(event), param(event, 'id'))
  return { ok: true }
})
