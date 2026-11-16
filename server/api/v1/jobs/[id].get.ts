import { getJob } from '../../../services/jobs'
import { notFound } from '../../../services/errors'
import { defineApi, param, requireActor } from '../../../utils/api'

export default defineApi((event, ctx) => {
  const actor = requireActor(event)
  const job = getJob(ctx, param(event, 'id'))
  // Your own jobs, or any job for operators and admins (docs/14-api.md).
  if (!job || (job.createdBy !== actor.id && !actor.isOperator && actor.role !== 'admin')) throw notFound('That job')
  // Status only: payloads can hold internal details.
  return { id: job.id, kind: job.kind, state: job.state, attempts: job.attempts, lastError: job.lastError, runAt: job.runAt, finishedAt: job.finishedAt }
})
