// The job worker loop, inside the builder process (ADR 0009). Off with SITEBUILDER_WORKER=0.
import { join } from 'node:path'
import { createEmailHandler, outboxMailer } from '../services/email'
import { createPublishHandler } from '../services/publish'
import { runJobsOnce, type JobHandlers } from '../services/jobs'
import { useServiceCtx } from '../utils/state'

const skipped = (what: string) => ({ run: () => ({ skipped: `${what} is not built yet` }) })

export const handlers: JobHandlers = {
  publish: createPublishHandler(),
  // SMTP is not built yet. Outside production (or with SITEBUILDER_MAIL_OUTBOX set) emails go to a folder.
  send_email: createEmailHandler({
    mailer: process.env.SITEBUILDER_MAIL_OUTBOX || process.env.NODE_ENV !== 'production' ? outboxMailer(process.env.SITEBUILDER_MAIL_OUTBOX || join('.data', 'outbox')) : null,
    baseUrl: process.env.SITEBUILDER_ORIGIN ?? 'http://localhost:3000',
  }),
  purge_cache: skipped('Cloudflare purge'),
  media_renditions: skipped('Image renditions'),
  run_checks: skipped('Rendered-page checks'),
  render_preview: skipped('Preview rendering'),
  backup: skipped('Backups'),
  bin_cleanup: skipped('Bin clean-up'),
}

export default defineNitroPlugin((nitro) => {
  if (process.env.SITEBUILDER_WORKER === '0' || import.meta.prerender) return
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const ctx = useServiceCtx()
      while (await runJobsOnce(ctx, handlers)) {}
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not been set up'))) console.error(JSON.stringify({ level: 'error', msg: 'worker', error: String(error) }))
    } finally {
      busy = false
    }
  }, 1000)
  nitro.hooks.hook('close', () => clearInterval(timer))
})
