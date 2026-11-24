// Refuses demo mutations before api-auth, so a missing CSRF Origin still returns the demo 403.
import { setResponseHeader, setResponseStatus } from 'h3'
import { demoMutationRefusal } from '../services/demo-locks'
import { demoMode } from '../services/demo-mode'

export default defineEventHandler((event) => {
  if (!demoMode()) return
  const path = event.path.split('?')[0] ?? '/'
  const message = demoMutationRefusal(event.method, path)
  if (!message) return
  setResponseStatus(event, 403)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  return { error: { code: 'forbidden', message } }
})
