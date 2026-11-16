import { settingsPatchSchema } from '../../../../shared/settings'
import { updateSettings } from '../../../services/settings'
import { defineApi, parseBody, requireActor } from '../../../utils/api'

export default defineApi(async (event, ctx) => updateSettings(ctx, requireActor(event), await parseBody(event, settingsPatchSchema)))
