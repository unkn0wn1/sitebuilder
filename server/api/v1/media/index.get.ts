import { z } from 'zod'
import { listMedia } from '../../../services/media'
import { defineApi, paging, parseQuery, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  return listMedia(ctx, parseQuery(event, paging.extend({ search: z.string().max(200).optional() })))
})
