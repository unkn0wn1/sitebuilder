import { z } from 'zod'
import { listOps } from '../../../../services/pages'
import { defineApi, param, parseQuery, requireCan } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'page.read')
  const { since } = parseQuery(event, z.object({ since: z.coerce.number().int().min(0).default(0) }))
  return { items: listOps(ctx, param(event, 'id'), since) }
})
