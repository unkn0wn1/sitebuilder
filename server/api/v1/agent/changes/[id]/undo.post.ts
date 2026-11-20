import { z } from 'zod'
import { adminUndoChange } from '../../../../../services/agent/admin'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

// One click: put back what the page or part said before the agent's change, and publish it now.
export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { reason } = await parseBody(event, z.object({ reason: z.string().trim().min(5).max(500) }).strict())
  return adminUndoChange(ctx, actor, param(event, 'id'), reason)
})
