import { setResponseHeader } from 'h3'
import { demoMode } from '../../../services/demo-mode'
import { currentSandbox } from '../../../services/demo-sandbox'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const docsUrl = process.env.SITEBUILDER_DOCS_URL?.trim() || null
  if (!demoMode()) return { demo: false, lastReset: null, docsUrl }
  return { demo: true, lastReset: currentSandbox()?.meta.lastReset ?? null, docsUrl }
})
