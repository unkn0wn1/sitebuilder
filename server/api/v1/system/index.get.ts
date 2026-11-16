import { dirname } from 'node:path'
import { useRuntimeConfig } from 'nitropack/runtime'
import { systemStatus } from '../../../services/system'
import { defineApi, requireCan } from '../../../utils/api'
import { dbPath } from '../../../utils/state'

export default defineApi((event, ctx) => {
  requireCan(event, 'system.read')
  const path = dbPath()
  return systemStatus(ctx, { version: String(useRuntimeConfig().version ?? 'unknown'), dbPath: path, dataDir: path === ':memory:' ? '.' : dirname(path) })
})
