import { listBackupJobs, resolveBackupStore } from '../../../services/backup'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi(async (event, ctx) => {
  requireCan(event, 'backups.manage')
  const jobs = listBackupJobs(ctx)
  const store = resolveBackupStore()
  const stored = store ? (await store.list()).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()) : []
  return { jobs, store: store ? { kind: store.kind, location: store.location, items: stored } : null }
})
