import { getJob } from '../../../services/jobs'
import { notFound } from '../../../services/errors'
import { defineApi, param, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  requireActor(event)
  const job = getJob(ctx, param(event, 'id'))
  if (!job) throw notFound('That job')
  // Status only: payloads can hold internal details.
  return { id: job.id, kind: job.kind, state: job.state, attempts: job.attempts, lastError: job.lastError, runAt: job.runAt, finishedAt: job.finishedAt }
})
