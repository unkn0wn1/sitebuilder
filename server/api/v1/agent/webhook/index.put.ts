import { z } from 'zod'
import { setWebhook } from '../../../../services/agent/webhook'
import { defineApi, parseBody, requireActor } from '../../../../utils/api'

// Save the alert address, the events and (write-only) the signing secret. The service checks every field.
export default defineApi(async (event, ctx) => setWebhook(ctx, requireActor(event), await parseBody(event, z.record(z.string(), z.unknown()))))
