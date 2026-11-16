import { cancelAiSession } from '../../../../../services/ai'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => ({ session: cancelAiSession(ctx, requireActor(event), param(event, 'id')) }))
