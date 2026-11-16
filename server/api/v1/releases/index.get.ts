import { listReleases } from '../../../services/publish'
import { defineApi, requireCan } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireCan(event, 'release.read')
  return { items: listReleases(ctx) }
})
