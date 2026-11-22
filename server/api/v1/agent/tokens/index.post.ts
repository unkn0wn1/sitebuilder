import { createAgentToken, tokenInputSchema } from '../../../../services/agent/tokens'
import { defineApi, parseBody, requireActor } from '../../../../utils/api'

// The secret is in this response once and never again. Only its hash is stored.
export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const input = await parseBody(event, tokenInputSchema.loose())
  return createAgentToken(ctx, actor, input)
})
