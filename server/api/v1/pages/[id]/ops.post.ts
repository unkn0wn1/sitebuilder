import { opsRequestSchema } from '../../../../../shared/ops'
import { applyPageOps } from '../../../../services/pages'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { baseRevision, ops } = await parseBody(event, opsRequestSchema)
  return applyPageOps(ctx, actor, param(event, 'id'), baseRevision, ops)
})
