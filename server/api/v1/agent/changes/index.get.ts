import { z } from 'zod'
import { AGENT_CHANGE_STATUSES } from '../../../../db/schema'
import { listAllChanges } from '../../../../services/agent/admin'
import { defineApi, parseQuery, requireActor } from '../../../../utils/api'

const query = z.object({ status: z.enum(AGENT_CHANGE_STATUSES).optional(), tokenId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })

export default defineApi((event, ctx) => ({ changes: listAllChanges(ctx, requireActor(event), parseQuery(event, query)) }))
