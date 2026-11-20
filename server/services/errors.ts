// Application errors with the shape from docs/14-api.md#errors.
import type { FieldIssue } from '../../shared/issues'

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'csrf'
  | 'not_found'
  | 'conflict'
  | 'invalid_state'
  | 'rate_limited'
  | 'rule_denied'
  | 'never_list'
  | 'agent_paused'
  | 'no_matches'
  | 'match_count_mismatch'
  | 'ai_unavailable'
  | 'not_set_up'
  | 'internal'

const STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  csrf: 403,
  not_found: 404,
  conflict: 409,
  invalid_state: 409,
  rate_limited: 429,
  rule_denied: 403,
  never_list: 403,
  agent_paused: 403,
  no_matches: 422,
  match_count_mismatch: 409,
  ai_unavailable: 503,
  not_set_up: 503,
  internal: 500,
}

export class AppError extends Error {
  readonly status: number
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: FieldIssue[],
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message)
    this.status = STATUS[code]
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...(this.fields?.length ? { fields: this.fields } : {}), ...(this.extra ?? {}) } }
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} wasn't found.`)
export const forbidden = (message = "You don't have permission to do that.") => new AppError('forbidden', message)
