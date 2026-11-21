import { previewForAdmin } from '../../../../../services/agent/admin'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => previewForAdmin(ctx, requireActor(event), param(event, 'id')))
