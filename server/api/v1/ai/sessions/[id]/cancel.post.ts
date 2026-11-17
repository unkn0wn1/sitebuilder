import { z } from 'zod'
import { cancelAiSession } from '../../../../../services/ai'
import { requestAiCancel } from '../../../../../services/ai-loop'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

const schema = z.object({ endSession: z.boolean().optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const id = param(event, 'id')
  const body = await parseBody(event, schema).catch(() => ({ endSession: true }))
  requestAiCancel(id)
  if (body.endSession === false) return { session: { id, state: 'active' }, stopped: true }
  return { session: cancelAiSession(ctx, actor, id), stopped: true }
})
