import { pluginCatalog } from '../../../services/plugins/catalog'
import { defineApi, requireActor } from '../../../utils/api'

/** Any signed-in editor. Not settings.manage: the picker needs the catalog, and install stays on the settings routes. */
export default defineApi((event, ctx) => {
  requireActor(event)
  return { blocks: pluginCatalog(ctx.registry) }
})
