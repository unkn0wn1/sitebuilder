import { listMemory } from '../../../services/memory'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => ({ items: listMemory(ctx, requireActor(event)) }))
