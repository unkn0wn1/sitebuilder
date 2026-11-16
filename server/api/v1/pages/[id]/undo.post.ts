import { z } from 'zod'
import { undoOp } from '../../../../services/pages'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { opId } = await parseBody(event, z.object({ opId: z.string().min(1).max(64) }))
  return undoOp(ctx, actor, param(event, 'id'), opId)
})
