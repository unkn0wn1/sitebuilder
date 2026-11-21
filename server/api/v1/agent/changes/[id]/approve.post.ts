import { z } from 'zod'
import { approveWholeChange } from '../../../../../services/agent/admin'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

// Approve every page and part of an agent change that is waiting, in one step.
export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const body = await parseBody(event, z.object({ overrideReason: z.string().trim().min(5).max(500).optional() }).strict())
  return approveWholeChange(ctx, actor, param(event, 'id'), body)
})
