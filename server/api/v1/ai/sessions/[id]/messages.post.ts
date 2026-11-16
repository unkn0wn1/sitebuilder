import { getAiSession } from '../../../../../services/ai'
import { AppError } from '../../../../../services/errors'
import { defineApi, param, requireActor } from '../../../../../utils/api'

// The model harness is not built yet (see docs/09-roadmap.md). Tools and permissions are, in services/ai.ts.
export default defineApi((event, ctx) => {
  getAiSession(ctx, requireActor(event), param(event, 'id'))
  throw new AppError('ai_unavailable', "The assistant isn't switched on yet. You can still edit the page yourself.")
})
