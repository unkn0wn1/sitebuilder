import { startXaiDeviceLogin } from '../../../../../services/xai-oauth'
import { defineApi, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => startXaiDeviceLogin(ctx, requireActor(event)))
