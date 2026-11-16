import { z } from 'zod'
import { createEmbed } from '../../../services/site'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

const schema = z.object({ provider: z.string().min(1).max(40), name: z.string().trim().min(1).max(100), config: z.record(z.string(), z.string().max(100)) })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return createEmbed(ctx, actor, await parseBody(event, schema))
})
