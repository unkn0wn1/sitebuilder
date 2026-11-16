import { z } from 'zod'
import { acceptInvite } from '../../../../services/auth'
import { defineApi, parseBody } from '../../../../utils/api'

const schema = z.object({ token: z.string().min(10).max(200), name: z.string().trim().min(1).max(100), password: z.string().max(200) })

export default defineApi(async (event, ctx) => {
  const input = await parseBody(event, schema)
  const user = acceptInvite(ctx, input.token, input.name, input.password)
  return { user: { id: user.id, name: user.name, email: user.email } }
})
