import { z } from 'zod'
import { submitBrand } from '../../../services/brand'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return submitBrand(ctx, actor, await parseBody(event, z.object({ note: z.string().trim().max(1000).optional() })))
})
