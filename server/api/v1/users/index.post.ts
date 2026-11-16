import { z } from 'zod'
import { ROLES } from '../../../../shared/roles'
import { audit } from '../../../services/audit'
import { createUser } from '../../../services/auth'
import { enqueueJob } from '../../../services/jobs'
import { defineApi, parseBody, requireCan } from '../../../utils/api'

const schema = z.object({ email: z.string().trim().email().max(254), name: z.string().trim().min(1).max(100), role: z.enum(ROLES), isOperator: z.boolean().default(false) })

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'users.manage')
  const input = await parseBody(event, schema)
  const { user } = createUser(ctx, input)
  // No raw token in the job payload: the email job mints its own invite link when it sends.
  enqueueJob(ctx, 'send_email', { kind: 'invite', userId: user.id }, { createdBy: actor.id })
  audit(ctx, actor, 'user.invited', { type: 'user', id: user.id }, { role: user.role, isOperator: user.isOperator })
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } }
})
