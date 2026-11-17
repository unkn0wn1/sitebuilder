import { z } from 'zod'
import { templateRulesSchema } from '../../../../shared/templates'
import { createTemplateDraft } from '../../../services/templates'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

const schema = z
  .object({
    key: z.string().trim().min(1).max(40),
    rules: templateRulesSchema,
  })
  .strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return createTemplateDraft(ctx, actor, await parseBody(event, schema))
})
