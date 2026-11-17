import { resolveAi, unavailableMessage } from '../../../services/ai-loop'
import { defineApi, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireActor(event)
  const resolved = resolveAi(ctx)
  return {
    enabled: resolved.enabled,
    available: resolved.available,
    reason: resolved.reason,
    message: resolved.available ? null : unavailableMessage(resolved.reason),
    caps: {
      monthlyCapPence: resolved.settings.monthlyCapPence,
      sessionCapPence: resolved.settings.sessionCapPence,
      requestCapPence: resolved.settings.requestCapPence,
      monthUsedPence: Math.round((resolved.monthMicros / 10000) * 10) / 10,
    },
  }
})
