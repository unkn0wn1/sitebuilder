import { z } from 'zod'
import { BRIEF_QUESTION_IDS } from '../../../../../../shared/page-brief'
import { answerPageBrief } from '../../../../../services/page-brief'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

const schema = z
  .object({
    questionId: z.enum(BRIEF_QUESTION_IDS).optional(),
    prompt: z.string().max(280).optional(),
    chip: z.string().trim().max(80).optional(),
    text: z.string().trim().max(2000).optional(),
  })
  .strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return answerPageBrief(ctx, actor, param(event, 'id'), await parseBody(event, schema))
})
