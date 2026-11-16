import { acceptMemory } from '../../../../services/memory'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => ({ entry: acceptMemory(ctx, requireActor(event), param(event, 'id')) }))
