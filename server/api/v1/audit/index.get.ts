import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditEvents } from '../../../db/schema'
import { defineApi, paging, parseQuery, requireCan } from '../../../utils/api'

const schema = paging.extend({ targetType: z.string().max(40).optional(), targetId: z.string().max(64).optional(), actorId: z.string().max(64).optional() })

export default defineApi((event, ctx) => {
  requireCan(event, 'audit.read')
  const q = parseQuery(event, schema)
  const where = and(
    eq(auditEvents.siteId, ctx.siteId),
    q.targetType ? eq(auditEvents.targetType, q.targetType) : undefined,
    q.targetId ? eq(auditEvents.targetId, q.targetId) : undefined,
    q.actorId ? eq(auditEvents.actorId, q.actorId) : undefined,
  )
  const total = ctx.db.select({ n: sql<number>`count(*)` }).from(auditEvents).where(where).get()?.n ?? 0
  const items = ctx.db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.at)).limit(q.pageSize).offset((q.page - 1) * q.pageSize).all()
  return { items, page: q.page, pageSize: q.pageSize, total }
})
