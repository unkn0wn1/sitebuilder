// Background jobs in a table, claimed with a lease. See ADR 0009 and docs/16-operations.md#background-jobs.
import { and, asc, eq, inArray, lte, or, lt } from 'drizzle-orm'
import { newId } from '../../shared/ids'
import { jobs, type JobKind } from '../db/schema'
import type { ServiceCtx } from './context'

export type Lane = 'publish' | 'media' | 'light'

export const LANE_OF: Record<JobKind, Lane> = {
  publish: 'publish',
  render_preview: 'publish',
  run_checks: 'publish',
  media_renditions: 'media',
  send_email: 'light',
  purge_cache: 'light',
  backup: 'light',
  bin_cleanup: 'light',
  agent_webhook: 'light',
}

/** Delay before retry n (1-based). */
export const BACKOFF_MS = [30_000, 120_000, 600_000]
export const LEASE_MS = 5 * 60_000

export type Job = typeof jobs.$inferSelect

export function enqueueJob(
  ctx: ServiceCtx,
  kind: JobKind,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; maxAttempts?: number; createdBy?: string } = {},
): string {
  const id = newId('job', ctx.now().getTime())
  ctx.db
    .insert(jobs)
    .values({
      id,
      siteId: ctx.siteId,
      kind,
      lane: LANE_OF[kind],
      payload,
      state: 'queued',
      runAt: (opts.runAt ?? ctx.now()).toISOString(),
      maxAttempts: opts.maxAttempts ?? 4,
      createdBy: opts.createdBy ?? null,
      createdAt: ctx.now().toISOString(),
    })
    .run()
  return id
}

/** Claim the oldest due job in a lane (or one whose lease ran out). Atomic. */
export function claimNextJob(ctx: ServiceCtx, lane: Lane): Job | undefined {
  const now = ctx.now().toISOString()
  const due = ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.siteId, ctx.siteId),
        eq(jobs.lane, lane),
        or(and(eq(jobs.state, 'queued'), lte(jobs.runAt, now)), and(eq(jobs.state, 'running'), lt(jobs.leaseUntil, now))),
      ),
    )
    .orderBy(asc(jobs.runAt), asc(jobs.id))
    .limit(1)
  return ctx.db
    .update(jobs)
    .set({ state: 'running', leaseUntil: new Date(ctx.now().getTime() + LEASE_MS).toISOString() })
    .where(inArray(jobs.id, due))
    .returning()
    .get()
}

export function completeJob(ctx: ServiceCtx, id: string, result: Record<string, unknown> = {}) {
  ctx.db.update(jobs).set({ state: 'done', result, leaseUntil: null, finishedAt: ctx.now().toISOString() }).where(eq(jobs.id, id)).run()
}

/** Record a failure. Returns true if this was the final attempt. */
export function failJob(ctx: ServiceCtx, job: Job, error: unknown): boolean {
  const attempts = job.attempts + 1
  const message = error instanceof Error ? error.message : String(error)
  const final = attempts >= job.maxAttempts
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!
  ctx.db
    .update(jobs)
    .set({
      attempts,
      lastError: message,
      leaseUntil: null,
      state: final ? 'failed' : 'queued',
      runAt: final ? job.runAt : new Date(ctx.now().getTime() + delay).toISOString(),
      finishedAt: final ? ctx.now().toISOString() : null,
    })
    .where(eq(jobs.id, job.id))
    .run()
  return final
}

export interface JobHandler {
  run(ctx: ServiceCtx, job: Job): Record<string, unknown> | void | Promise<Record<string, unknown> | void>
  /** Called once, after the last attempt fails. */
  onFinalFailure?(ctx: ServiceCtx, job: Job, error: unknown): void
}

export type JobHandlers = Partial<Record<JobKind, JobHandler>>

/** Run at most one job from each lane. Returns how many ran. */
export async function runJobsOnce(ctx: ServiceCtx, handlers: JobHandlers, lanes: Lane[] = ['publish', 'media', 'light']): Promise<number> {
  let ran = 0
  for (const lane of lanes) {
    const job = claimNextJob(ctx, lane)
    if (!job) continue
    ran++
    const handler = handlers[job.kind]
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}".`)
      const result = await handler.run(ctx, job)
      completeJob(ctx, job.id, result ?? {})
    } catch (error) {
      if (failJob(ctx, job, error)) handler?.onFinalFailure?.(ctx, job, error)
    }
  }
  return ran
}

export function getJob(ctx: ServiceCtx, id: string): Job | undefined {
  return ctx.db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.siteId, ctx.siteId))).get()
}
