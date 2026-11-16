import { z } from 'zod'
import { rollbackSite } from '../../../../services/publish'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { reason } = await parseBody(event, z.object({ reason: z.string().trim().min(5).max(500) }))
  return rollbackSite(ctx, actor, param(event, 'id'), reason)
})
