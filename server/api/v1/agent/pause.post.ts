import { z } from 'zod'
import { setAgentsPaused } from '../../../services/agent/tokens'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

// The kill switch: every token stops working until an admin resumes.
export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { paused } = await parseBody(event, z.object({ paused: z.boolean() }).strict())
  return setAgentsPaused(ctx, actor, paused)
})
