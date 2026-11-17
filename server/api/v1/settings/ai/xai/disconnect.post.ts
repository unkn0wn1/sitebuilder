import { disconnectXaiOauth } from '../../../../../services/xai-oauth'
import { defineApi, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => disconnectXaiOauth(ctx, requireActor(event)))
