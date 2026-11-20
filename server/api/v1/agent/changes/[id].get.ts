import { getAnyChange } from '../../../../services/agent/admin'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => getAnyChange(ctx, requireActor(event), param(event, 'id')))
