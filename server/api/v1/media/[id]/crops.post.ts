import { approveCrop, cropInputSchema } from '../../../../services/media'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => approveCrop(ctx, requireActor(event), param(event, 'id'), await parseBody(event, cropInputSchema)))
