import { restoreFromBin } from '../../../../services/pages'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => restoreFromBin(ctx, requireActor(event), param(event, 'id')))
