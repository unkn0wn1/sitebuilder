import { z } from 'zod'
import { installFromRepository } from '../../../../services/plugins/repository'
import { defineApi, parseBody, requireCan } from '../../../../utils/api'

const body = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'Use the plugin id from the repository.'),
  version: z.string().min(1).max(32),
  repoUrl: z.string().max(300).optional(),
})

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const input = await parseBody(event, body)
  return installFromRepository(ctx, actor, input)
})
