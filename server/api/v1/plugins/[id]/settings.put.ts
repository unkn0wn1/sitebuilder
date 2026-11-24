import { readBody } from 'h3'
import { savePluginSettings } from '../../../../services/plugins/lifecycle'
import { defineApi, param, requireCan } from '../../../../utils/api'

export default defineApi(async (event, ctx) => {
  const actor = requireCan(event, 'settings.manage')
  const body = await readBody(event).catch(() => undefined)
  return savePluginSettings(ctx, actor, param(event, 'id'), body ?? {})
})
