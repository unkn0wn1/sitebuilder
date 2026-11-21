import { z } from 'zod'
import { listAgentAudit } from '../../../services/agent/admin'
import { defineApi, paging, parseQuery, requireActor } from '../../../utils/api'

const schema = paging.extend({ tokenId: z.string().max(80).optional() })

export default defineApi((event, ctx) => listAgentAudit(ctx, requireActor(event), parseQuery(event, schema)))
