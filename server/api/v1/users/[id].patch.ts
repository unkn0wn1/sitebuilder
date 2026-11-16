import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ROLES } from '../../../../shared/roles'
import { users } from '../../../db/schema'
import { audit } from '../../../services/audit'
import { revokeAllSessions } from '../../../services/auth'
import { AppError, notFound } from '../../../services/errors'
import { defineApi, param, parseBody, requireCan } from '../../../utils/api'

const schema = z.object({ role: z.enum(ROLES).optional(), isOperator: z.boolean().optional(), status: z.enum(['active', 'deactivated']).optional() })

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'users.manage')
  const id = param(event, 'id')
  const input = await parseBody(event, schema)
  const user = ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.siteId, ctx.siteId))).get()
  if (!user) throw notFound('That user')
  if (id === actor.id && (input.role && input.role !== 'admin' || input.status === 'deactivated')) {
    throw new AppError('invalid_state', "You can't remove your own admin access. Ask another admin.")
  }
  ctx.db.update(users).set(input).where(eq(users.id, id)).run()
  if (input.status === 'deactivated') revokeAllSessions(ctx, id)
  audit(ctx, actor, 'user.updated', { type: 'user', id }, input)
  return { ok: true }
})
