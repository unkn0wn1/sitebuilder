import { z } from 'zod'
import { plannedSectionSchema } from '../../../../../../shared/page-brief'
import { buildPageBrief } from '../../../../../services/page-brief'
import { defineApi, param, parseBody, requireActor } from '../../../../../utils/api'

const schema = z.object({ saveAsTemplate: z.boolean().optional(), sections: z.array(plannedSectionSchema).min(1).max(16).optional() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return buildPageBrief(ctx, actor, param(event, 'id'), await parseBody(event, schema))
})
