import { deleteCookie, getCookie } from 'h3'
import { revokeSession } from '../../../services/auth'
import { defineApi, SESSION_COOKIE } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) revokeSession(ctx, token)
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  return { ok: true }
})
