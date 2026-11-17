import { getQuery, sendRedirect } from 'h3'
import { AppError } from '../../../../../services/errors'
import { finishGoogleConnect } from '../../../../../services/gmail'
import { defineApi } from '../../../../../utils/api'
import type { ActingAs } from '../../../../../services/context'

// Google redirects the browser here. Session cookies are SameSite=Strict, so they may be
// missing; the signed state carries the admin who started the connect. Always redirect,
// never return a JSON error page to the user.
export default defineApi(async (event, ctx) => {
  const q = getQuery(event)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  try {
    const actor = event.context.actor as ActingAs | undefined
    await finishGoogleConnect(ctx, actor, { code: str(q.code), state: str(q.state), error: str(q.error) })
    return sendRedirect(event, '/settings?mail=connected', 302)
  } catch (error) {
    const reason = error instanceof AppError ? error.code : 'internal'
    return sendRedirect(event, `/settings?mail=error&reason=${encodeURIComponent(reason)}`, 302)
  }
})
