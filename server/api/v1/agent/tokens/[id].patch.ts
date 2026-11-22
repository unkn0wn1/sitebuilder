import { z } from 'zod'
import { updateAgentToken } from '../../../../services/agent/tokens'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const body = await parseBody(event, z.record(z.string(), z.unknown()))
  return { token: updateAgentToken(ctx, actor, param(event, 'id'), body) }
})
