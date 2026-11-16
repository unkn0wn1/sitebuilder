// One shape for validation problems, used by the API, the GUI and the AI. See docs/14-api.md#errors.
import type { z } from 'zod'

export interface FieldIssue {
  /** Dotted path, for example "blocks.2.props.heading". */
  path: string
  /** Plain English, safe to show to a person. */
  message: string
}

export function zodIssues(error: z.ZodError, prefix = ''): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((p) => p !== '').join('.'),
    message: issue.message,
  }))
}
