import { setResponseHeader } from 'h3'
import { notFound } from '../../../../services/errors'
import { defineApi, param, requireCan } from '../../../../utils/api'
import { EMBED_JS, ISLANDS_JS, MENU_JS } from '../../../../theme/default'

const FILES: Record<string, string> = { 'menu.js': MENU_JS, 'islands.js': ISLANDS_JS, 'embed.js': EMBED_JS }

// The public site's small scripts (menus, carousels), for builder previews.
export default defineApi((event) => {
  requireCan(event, 'page.read')
  const body = FILES[param(event, 'name')]
  if (!body) throw notFound('That file')
  setResponseHeader(event, 'content-type', 'text/javascript; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  return body
})
