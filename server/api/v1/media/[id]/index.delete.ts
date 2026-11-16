import { binMedia } from '../../../../services/media'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  binMedia(ctx, requireActor(event), param(event, 'id'))
  return { ok: true }
})
