import { z } from 'zod'
import { MAX_BRIEF_PROMPT } from '../../../../../shared/page-brief'
import { startPageBrief } from '../../../../services/page-brief'
import { defineApi, parseBody, requireActor } from '../../../../utils/api'

const schema = z.object({ prompt: z.string().trim().min(1).max(MAX_BRIEF_PROMPT) })

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return startPageBrief(ctx, actor, (await parseBody(event, schema)).prompt)
})
