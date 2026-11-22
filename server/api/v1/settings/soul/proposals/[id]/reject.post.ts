import { z } from 'zod'
import { rejectSoulProposal } from '../../../../../../services/soul-proposals'
import { defineApi, param, parseBody, requireCan } from '../../../../../../utils/api'

const bodySchema = z.object({ note: z.string().trim().max(500).optional() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await parseBody(event, bodySchema)
  return rejectSoulProposal(ctx, actor, param(event, 'id'), body)
})
