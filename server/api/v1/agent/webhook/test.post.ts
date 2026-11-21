import { queueTestWebhook } from '../../../../services/agent/webhook'
import { defineApi, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => queueTestWebhook(ctx, requireActor(event)))
