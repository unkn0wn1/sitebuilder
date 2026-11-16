import { deleteMemory } from '../../../../services/memory'
import { defineApi, param, requireActor } from '../../../../utils/api'

export default defineApi((event, ctx) => {
  deleteMemory(ctx, requireActor(event), param(event, 'id'))
  return { ok: true }
})
