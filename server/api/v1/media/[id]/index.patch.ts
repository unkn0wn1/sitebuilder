import { mediaPatchSchema, updateMedia } from '../../../../services/media'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => ({ media: updateMedia(ctx, requireActor(event), param(event, 'id'), await parseBody(event, mediaPatchSchema)) }))
