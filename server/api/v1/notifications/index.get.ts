import { and, desc, eq } from 'drizzle-orm'
import { notifications } from '../../../db/schema'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  return { items: ctx.db.select().from(notifications).where(and(eq(notifications.siteId, ctx.siteId), eq(notifications.userId, actor.id))).orderBy(desc(notifications.createdAt)).limit(50).all() }
})
