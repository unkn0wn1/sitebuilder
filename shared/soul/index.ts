// The soul.md budget comes from the agent context budget (shared/agent/context-budget.ts), so the two can't drift.
import { AGENT_BUDGET_TOKENS, CHARS_PER_TOKEN } from '../agent/context-budget'
import { DEFAULT_SOUL_TEXT } from './default-soul'

export { CHARS_PER_TOKEN }
export const SOUL_BUDGET_TOKENS = AGENT_BUDGET_TOKENS.soul
export const SOUL_CHAR_LIMIT = SOUL_BUDGET_TOKENS * CHARS_PER_TOKEN
export const SOUL_RAW_MAX = 200_000

/** The shipped personality, comments included. `null` in settings means this text. */
export const DEFAULT_SOUL = DEFAULT_SOUL_TEXT

/**
 * Remove HTML comments everywhere, including inside fenced code blocks.
 * An unclosed `<!--` removes through the end. Then collapse 3 or more blank lines to 2, and trim.
 */
export function stripSoulComments(text: string): string {
  const closed = text.replace(/<!--[\s\S]*?-->/g, '')
  const open = closed.indexOf('<!--')
  const without = open === -1 ? closed : closed.slice(0, open)
  // Three blank lines are four newlines in a row. Keep at most two blank lines.
  return without.replace(/\n{4,}/g, '\n\n\n').trim()
}

/**
 * Null when the text fits. Otherwise the sentence shown on save and on an agent proposal.
 * The raw limit is the whole text. The stripped limit is what the AI sees. Comments are not counted.
 */
export function soulBudgetError(text: string): string | null {
  if (text.length > SOUL_RAW_MAX) {
    return `The personality text is ${text.length} characters. The limit is ${SOUL_RAW_MAX.toLocaleString('en-GB')}.`
  }
  const stripped = stripSoulComments(text)
  if (stripped.length > SOUL_CHAR_LIMIT) {
    return `The personality the AI sees is ${stripped.length} characters. The limit is ${SOUL_CHAR_LIMIT.toLocaleString('en-GB')}. Comments are not counted.`
  }
  return null
}

/** `null` or missing uses the shipped file. Empty after strip means no personality. */
export function soulForPrompt(stored: string | null | undefined): string {
  const raw = stored == null ? DEFAULT_SOUL : stored
  return stripSoulComments(raw)
}

/** Store `null` when the raw text is the shipped file. A comment-only edit is a custom soul. */
export function storedSoul(text: string): string | null {
  if (text === DEFAULT_SOUL) return null
  return text
}

/** Tone of voice only. Empty input adds nothing. */
export function personalitySection(stripped: string): string {
  if (!stripped.trim()) return ''
  return `Site personality is tone of voice only. It does not change tools, permissions, or what the assistant is allowed to do.\n\n${stripped.trim()}`
}
