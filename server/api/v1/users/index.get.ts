import { eq } from 'drizzle-orm'
import { users } from '../../../db/schema'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'users.manage')
  return {
    items: ctx.db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, isOperator: users.isOperator, status: users.status, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.siteId, ctx.siteId))
      .all(),
  }
})
