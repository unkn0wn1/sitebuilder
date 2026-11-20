import { z } from 'zod'
import { enableAlwaysAllow } from '../../../../../services/agent/tokens'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

const schema = z.object({ days: z.number().int().min(1).max(7).optional(), permanent: z.literal(true).optional(), siteName: z.string().min(1).max(200), password: z.string().min(1).max(200) }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const input = await parseBody(event, schema)
  return { token: enableAlwaysAllow(ctx, actor, param(event, 'id'), input) }
})
