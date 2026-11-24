import { approvePlugin } from '../../../../services/plugins/lifecycle'
import { defineApi, param, requireActor } from '../../../../utils/api'

// Origin confirm needs the owner (actor.isOperator), checked in the service.
// A proposal id needs settings.manage, also checked in the service. Not requireCan here:
// a plain admin must be able to approve a proposal, and only an owner may confirm origins.
export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return approvePlugin(ctx, actor, param(event, 'id'))
})
