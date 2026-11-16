import { z } from 'zod'
import { resetPassword } from '../../../../services/auth'
import { defineApi, parseBody } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const { token, password } = await parseBody(event, z.object({ token: z.string().min(10).max(200), password: z.string().max(200) }))
  resetPassword(ctx, token, password)
  return { ok: true }
})
