import { z } from 'zod'
import { submitPage } from '../../../../services/reviews'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

const schema = z.object({ note: z.string().trim().max(1000).optional(), overrideReason: z.string().trim().min(5).max(500).optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return submitPage(ctx, actor, param(event, 'id'), await parseBody(event, schema))
})
