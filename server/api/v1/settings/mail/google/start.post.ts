import { startGoogleConnect } from '../../../../../services/gmail'
import { defineApi, requireCan } from '../../../../../utils/api'

export default defineApi((event, ctx) => startGoogleConnect(ctx, requireCan(event, 'settings.manage')))
