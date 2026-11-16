import { getAiSession } from '../../../../../services/ai'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => ({ session: getAiSession(ctx, requireActor(event), param(event, 'id')) }))
