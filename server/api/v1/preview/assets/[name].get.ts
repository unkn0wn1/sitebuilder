import { setResponseHeader } from 'h3'
import { previewAssetBody } from '../../../../services/draft-preview'
import { notFound } from '../../../../services/errors'
import { defineApi, param, requireCan } from '../../../../utils/api'

// The public site's small scripts (the donation form loader, header, hero carousel), for builder previews.
export default defineApi((event) => {
  requireCan(event, 'page.read')
  const body = previewAssetBody(param(event, 'name'))
  if (!body) throw notFound('That file')
  setResponseHeader(event, 'content-type', 'text/javascript; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'private, max-age=300')
  return body
})
