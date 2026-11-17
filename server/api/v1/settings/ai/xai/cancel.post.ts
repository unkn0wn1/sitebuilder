import { z } from 'zod'
import { cancelXaiDeviceLogin } from '../../../../../services/xai-oauth'
import { defineApi, parseBody, requireActor } from '../../../../../utils/api'

const schema = z.object({ pendingId: z.string().trim().min(1).max(128) })

export default defineApi(async (event, ctx) => cancelXaiDeviceLogin(ctx, requireActor(event), (await parseBody(event, schema)).pendingId))
