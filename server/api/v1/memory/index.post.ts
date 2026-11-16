import { z } from 'zod'
import { addMemory, MEMORY_MAX_CHARS } from '../../../services/memory'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

const schema = z.object({ scope: z.enum(['site', 'user']), text: z.string().trim().min(1).max(MEMORY_MAX_CHARS) })

export default defineApi(async (event, ctx) => ({ entry: addMemory(ctx, requireActor(event), await parseBody(event, schema)) }))
