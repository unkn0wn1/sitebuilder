import { z } from 'zod'
import { approveSoulProposal } from '../../../../../../services/soul-proposals'
import { defineApi, param, parseBody, requireCan } from '../../../../../../utils/api'

const bodySchema = z.object({ overwrite: z.boolean().optional(), currentHash: z.string().max(128).nullable().optional() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await parseBody(event, bodySchema)
  return approveSoulProposal(ctx, actor, param(event, 'id'), body)
})
