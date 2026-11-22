import { z } from 'zod'
import { requestPasswordReset } from '../../../../services/auth'
import { defineApi, parseBody } from '../../../../utils/api'
import { clientIp } from '../../../../utils/client-ip'
import { hit } from '../../../../utils/rate-limit'

// Same answer whether or not the account exists (docs/14-api.md#auth-and-users).
export default defineApi(async (event, ctx) => {
  const { email } = await parseBody(event, z.object({ email: z.string().trim().email().max(254) }))
  const ip = clientIp(event) ?? 'unknown'
  if (hit(`reset:ip:${ip}`, 10, 60 * 60_000) && hit(`reset:email:${email.toLowerCase()}`, 3, 60 * 60_000)) requestPasswordReset(ctx, email)
  return { ok: true, message: 'If that email has an account, a reset link is on its way.' }
})
