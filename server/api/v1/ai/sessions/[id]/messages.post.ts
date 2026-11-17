import { createEventStream, setResponseStatus } from 'h3'
import { z } from 'zod'
import { getAiSession } from '../../../../../services/ai'
import { resolveAi, runAiTurn, unavailableMessage } from '../../../../../services/ai-loop'
import { AppError } from '../../../../../services/errors'
import { param, parseBody, requireActor } from '../../../../../utils/api'
import { useServiceCtx } from '../../../../../utils/state'

const schema = z.object({ text: z.string().trim().min(1).max(8000) })

export default defineEventHandler(async (event) => {
  try {
    const ctx = useServiceCtx()
    const actor = requireActor(event)
    const session = getAiSession(ctx, actor, param(event, 'id'))
    const { text } = await parseBody(event, schema)
    const resolved = resolveAi(ctx)
    if (!resolved.available) throw new AppError('ai_unavailable', unavailableMessage(resolved.reason))

    const stream = createEventStream(event)
    void (async () => {
      try {
        for await (const ev of runAiTurn(ctx, actor, session.id, text)) {
          await stream.push({ event: ev.type, data: JSON.stringify(ev) })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The assistant isn't available right now. Everything else works as normal."
        await stream.push({ event: 'error', data: JSON.stringify({ type: 'error', message }) })
      } finally {
        await stream.close()
      }
    })()
    return stream.send()
  } catch (error) {
    if (error instanceof AppError) {
      setResponseStatus(event, error.status)
      return error.toBody()
    }
    throw error
  }
})
