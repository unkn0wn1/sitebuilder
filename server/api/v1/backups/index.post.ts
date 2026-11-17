import { requestBackup } from '../../../services/backup'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireCan(event, 'backups.manage')
  return requestBackup(ctx, actor)
})
