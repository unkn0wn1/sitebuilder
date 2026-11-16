// Route helpers: one error shape (docs/14-api.md#errors), Zod validation, and permission checks.
import { randomBytes } from 'node:crypto'
import { defineEventHandler, getQuery, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import { z } from 'zod'
import { zodIssues } from '../../shared/issues'
import { can, type Action } from '../../shared/roles'
import type { ActingAs, ServiceCtx } from '../services/context'
import { AppError, forbidden } from '../services/errors'
import { useServiceCtx } from './state'

export function defineApi<T>(fn: (event: H3Event, ctx: ServiceCtx) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await fn(event, useServiceCtx())
    } catch (error) {
      if (error instanceof AppError) {
        setResponseStatus(event, error.status)
        return error.toBody()
      }
      const ref = randomBytes(4).toString('hex')
      console.error(JSON.stringify({ level: 'error', ref, path: event.path, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }))
      setResponseStatus(event, 500)
      return { error: { code: 'internal', message: `Something went wrong. Reference: ${ref}`, ref } }
    }
  })
}

export async function parseBody<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.infer<S>> {
  const raw = await readBody(event).catch(() => undefined)
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid request.', zodIssues(parsed.error))
  return parsed.data
}

export function parseQuery<S extends z.ZodType>(event: H3Event, schema: S): z.infer<S> {
  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'Invalid query.', zodIssues(parsed.error))
  return parsed.data
}

export function param(event: H3Event, name: string): string {
  const v = getRouterParam(event, name)
  if (!v) throw new AppError('not_found', 'Not found.')
  return decodeURIComponent(v)
}

export function requireActor(event: H3Event): ActingAs {
  const actor = event.context.actor as ActingAs | undefined
  if (!actor) throw new AppError('unauthenticated', 'Please sign in.')
  return actor
}

export function requireCan(event: H3Event, action: Action): ActingAs {
  const actor = requireActor(event)
  if (!can(actor, action)) throw forbidden()
  return actor
}

export const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export const SESSION_COOKIE = 'sb_session'

export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.SITEBUILDER_INSECURE_COOKIES !== '1'
}
