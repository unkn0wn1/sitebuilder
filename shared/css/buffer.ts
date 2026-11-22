// Decide what a custom-CSS buffer may do: save, show an error, or inject into the preview.
import { CssRejected, cssIssueMessage, sanitizeCss } from './sanitize'

export { shouldInjectLiveCss } from './live'

export interface LiveCss {
  blockId: string
  css: string
}

export interface CssBufferAssessment {
  /** Line and column from the sanitiser. Null when the buffer is acceptable. */
  error: string | null
  /** Author text to store. Null means do not send. An empty string clears the field. */
  save: string | null
  /** Valid section CSS to offer the preview. The preview injects it only while the rendered HTML is behind. */
  live: LiveCss | null
}

export function assessCssBuffer(input: { buffer: string; saved: string; scope: 'section' | 'site'; sectionId?: string }): CssBufferAssessment {
  const saved = input.saved ?? ''
  if (!input.buffer.trim()) {
    return { error: null, save: saved.trim() ? '' : null, live: null }
  }
  try {
    sanitizeCss(input.buffer, { scope: input.scope, mode: 'check', sectionId: input.sectionId })
  } catch (error) {
    if (error instanceof CssRejected) return { error: cssIssueMessage(error), save: null, live: null }
    throw error
  }
  const live = input.scope === 'section' && input.sectionId ? { blockId: input.sectionId, css: input.buffer } : null
  return { error: null, save: input.buffer === saved ? null : input.buffer, live }
}
