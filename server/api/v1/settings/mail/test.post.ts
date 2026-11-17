import { z } from 'zod'
import { sendTestEmail } from '../../../../services/email'
import { defineApi, parseBody, requireCan } from '../../../../utils/api'

const schema = z.object({ to: z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Use a full email address.').optional() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await parseBody(event, schema)
  return sendTestEmail(ctx, actor, body.to)
})
