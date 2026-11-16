import { z } from 'zod'
import { TASK_TYPES } from '../../../../../shared/ai-tasks'
import { startAiSession } from '../../../../services/ai'
import { defineApi, parseBody, requireActor } from '../../../../utils/api'

const schema = z.object({ taskType: z.enum(TASK_TYPES), targetId: z.string().max(64).optional(), template: z.string().max(64).optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return { session: startAiSession(ctx, actor, await parseBody(event, schema)) }
})
