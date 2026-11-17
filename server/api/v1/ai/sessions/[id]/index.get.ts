import { getAiSession, listAiMessages } from '../../../../../services/ai'
import { defineApi, param, requireActor } from '../../../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  const id = param(event, 'id')
  return { session: getAiSession(ctx, actor, id), messages: listAiMessages(ctx, id) }
})
