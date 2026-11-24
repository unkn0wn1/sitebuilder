import { z } from 'zod'
import { removePluginData } from '../../../../services/plugins/lifecycle'
import { defineApi, param, parseBody, requireCan } from '../../../../utils/api'

const schema = z.object({ confirm: z.string() }).strict()

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await parseBody(event, schema)
  return removePluginData(ctx, actor, param(event, 'id'), body.confirm)
})
