import { revokeAgentToken } from '../../../../services/agent/tokens'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => ({ token: revokeAgentToken(ctx, requireActor(event), param(event, 'id')) }))
