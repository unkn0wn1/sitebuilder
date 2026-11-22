import { setCookie } from 'h3'
import { z } from 'zod'
import { checkLogin, createSession } from '../../../services/auth'
import { audit } from '../../../services/audit'
import { AppError } from '../../../services/errors'
import { defineApi, parseBody, secureCookies, SESSION_COOKIE } from '../../../utils/api'
import { clientIp } from '../../../utils/client-ip'
import { hit } from '../../../utils/rate-limit'

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) })

export default defineApi(async (event, ctx) => {
  const { email, password } = await parseBody(event, schema)
  const ip = clientIp(event) ?? 'unknown'
  if (!hit(`login:ip:${ip}`, 20, 15 * 60_000) || !hit(`login:email:${email.toLowerCase()}`, 10, 15 * 60_000)) {
    throw new AppError('rate_limited', 'Too many sign-in attempts. Wait 15 minutes and try again.')
  }
  const user = checkLogin(ctx, email, password)
  if (!user) throw new AppError('unauthenticated', "That email and password don't match.")
  const { token, expiresAt } = createSession(ctx, user.id)
  setCookie(event, SESSION_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: 'strict', path: '/', expires: new Date(expiresAt) })
  audit(ctx, { id: user.id, role: user.role, isOperator: user.isOperator }, 'auth.login')
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role, isOperator: user.isOperator } }
})
