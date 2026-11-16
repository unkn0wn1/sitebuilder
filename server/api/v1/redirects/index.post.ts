import { z } from 'zod'
import { createRedirect } from '../../../services/redirects'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

const schema = z.object({ fromPath: z.string().max(300), toPath: z.string().max(500), statusCode: z.union([z.literal(301), z.literal(302)]).optional() })

export default defineApi(async (event, ctx) => createRedirect(ctx, requireActor(event), await parseBody(event, schema)))
