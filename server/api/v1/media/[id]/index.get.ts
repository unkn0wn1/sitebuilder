import { getMedia } from '../../../../services/media'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return getMedia(ctx, param(event, 'id'))
})
