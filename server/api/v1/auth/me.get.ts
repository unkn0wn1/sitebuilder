import { eq } from 'drizzle-orm'
import { users } from '../../../db/schema'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  const user = ctx.db.select().from(users).where(eq(users.id, actor.id)).get()!
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role, isOperator: user.isOperator } }
})
