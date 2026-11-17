import { eq } from 'drizzle-orm'
import { sites, users } from '../../../db/schema'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  const user = ctx.db.select().from(users).where(eq(users.id, actor.id)).get()!
  const site = ctx.db.select({ name: sites.name, primaryDomain: sites.primaryDomain }).from(sites).where(eq(sites.id, ctx.siteId)).get()
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isOperator: user.isOperator },
    site: { name: site?.name ?? 'Site', primaryDomain: site?.primaryDomain ?? null },
  }
})
