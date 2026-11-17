import { z } from 'zod'
import { buildPageBrief } from '../../../../../services/page-brief'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

const schema = z.object({ saveAsTemplate: z.boolean().optional() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return buildPageBrief(ctx, actor, param(event, 'id'), await parseBody(event, schema))
})
