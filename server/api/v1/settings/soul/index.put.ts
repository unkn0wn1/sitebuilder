import { z } from 'zod'
import { saveSoul } from '../../../../services/soul'
import { defineApi, parseBody, requireCan } from '../../../../utils/api'

const bodySchema = z.object({ text: z.string() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await parseBody(event, bodySchema)
  return saveSoul(ctx, actor, body.text)
})
