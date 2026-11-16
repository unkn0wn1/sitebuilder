import { restoreVersion } from '../../../../../../services/pages'
import { defineApi, param, requireActor } from '../../../../../../utils/api'

export default defineApi((event, ctx) => restoreVersion(ctx, requireActor(event), param(event, 'id'), param(event, 'versionId')))
