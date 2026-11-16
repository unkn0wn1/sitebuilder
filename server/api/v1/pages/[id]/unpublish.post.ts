import { z } from 'zod'
import { unpublishPage } from '../../../../services/publish'
import { defineApi, param, parseBody, requireActor } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  const { redirectTo } = await parseBody(event, z.object({ redirectTo: z.string().max(300).nullish() }))
  return unpublishPage(ctx, actor, param(event, 'id'), redirectTo)
})
