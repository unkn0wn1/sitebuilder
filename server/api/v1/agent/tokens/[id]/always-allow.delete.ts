import { disableAlwaysAllow } from '../../../../../services/agent/tokens'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => ({ token: disableAlwaysAllow(ctx, requireActor(event), param(event, 'id')) }))
