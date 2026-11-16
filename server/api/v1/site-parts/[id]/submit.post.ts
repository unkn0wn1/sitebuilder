import { z } from 'zod'
import { submitSitePart } from '../../../../services/site-parts'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return submitSitePart(ctx, actor, param(event, 'id'), await parseBody(event, z.object({ note: z.string().trim().max(1000).optional() })))
})
