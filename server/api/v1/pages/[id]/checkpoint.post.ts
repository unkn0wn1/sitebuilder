import { z } from 'zod'
import { checkpoint } from '../../../../services/pages'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { summary } = await parseBody(event, z.object({ summary: z.string().trim().min(1).max(200) }))
  return checkpoint(ctx, actor, param(event, 'id'), summary)
})
