// The job worker loop, inside the builder process (ADR 0009). Off with SITEBUILDER_WORKER=0.
import { createBackupHandler, ensureBackupScheduled, resolveBackupStore } from '../services/backup'
import { createPurgeCacheHandler } from '../services/cloudflare'
import { createWebhookHandler } from '../services/agent/webhook'
import { createEmailHandler, resolveMailer } from '../services/email'
import { createMediaRenditionsHandler } from '../services/media'
import { createPublishHandler } from '../services/publish'
import { createFileReleaseWriter } from '../services/release'
import { runJobsOnce, type JobHandlers } from '../services/jobs'
import { mediaDir, siteRoot, useServiceCtx } from '../utils/state'

const skipped = (what: string) => ({ run: () => ({ skipped: `${what} is not built yet` }) })

function buildHandlers(): JobHandlers {
  return {
  publish: createPublishHandler(createFileReleaseWriter(siteRoot())),
  // Mail goes through resolveMailer: Gmail when connected, otherwise the file outbox in development.
  send_email: createEmailHandler({
    getMailer: resolveMailer,
    baseUrl: process.env.SITEBUILDER_ORIGIN ?? 'http://localhost:3000',
  }),
  purge_cache: createPurgeCacheHandler(),
  agent_webhook: createWebhookHandler(),
  media_renditions: createMediaRenditionsHandler(mediaDir()),
  run_checks: skipped('Rendered-page checks'),
  render_preview: skipped('Preview rendering'),
  backup: createBackupHandler({ mediaDir, getStore: resolveBackupStore }),
  bin_cleanup: skipped('Bin clean-up'),
  }
}

export default defineNitroPlugin((nitro) => {
  if (process.env.SITEBUILDER_WORKER === '0' || import.meta.prerender) return
  // Built on the first tick, after the database plugin has opened the database (plugins are not awaited).
  let handlers: JobHandlers | null = null
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const ctx = useServiceCtx()
      handlers ??= buildHandlers()
      ensureBackupScheduled(ctx)
      while (await runJobsOnce(ctx, handlers)) {}
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not been set up'))) console.error(JSON.stringify({ level: 'error', msg: 'worker', error: String(error) }))
    } finally {
      busy = false
    }
  }, 1000)
  nitro.hooks.hook('close', () => clearInterval(timer))
})
