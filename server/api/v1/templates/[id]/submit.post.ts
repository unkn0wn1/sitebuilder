import { z } from 'zod'
import { submitTemplate } from '../../../../services/templates'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return submitTemplate(ctx, actor, param(event, 'id'), await parseBody(event, z.object({ note: z.string().trim().max(1000).optional() })))
})
