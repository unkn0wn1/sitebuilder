import { suggestAltForMedia } from '../../../../services/alt-text'
import { defineApi, param, requireActor } from '../../../../utils/api'
import { mediaDir } from '../../../../utils/state'

export default defineApi(async (event, ctx) => {
  const actor = requireActor(event)
  return suggestAltForMedia(ctx, actor, param(event, 'id'), { mediaDir: mediaDir() })
})
