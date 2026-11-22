import { describe, expect, it } from 'vitest'
import { scopeThemeCss } from '../app/utils/theme-css'
import { DEFAULT_THEME_TOKENS, THEME_CSS, themeCssFromTokens } from '../shared/theme-css'

/** Every rule line is scoped. Blank lines and at-rules are left alone. */
function unscopedRuleLines(css: string): string[] {
  return css.split('\n').filter((line) => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('{') || trimmed.startsWith('@')) return false
    return !line.includes('.sb-canvas')
  })
}

describe('theme canvas scope', () => {
  it('scopes the real sheet and a custom accent, with no keyframes', () => {
    expect(THEME_CSS).not.toContain('@keyframes')
    expect(unscopedRuleLines(scopeThemeCss(THEME_CSS))).toEqual([])
    const custom = themeCssFromTokens({ ...DEFAULT_THEME_TOKENS, accent: '#113399' })
    expect(custom).not.toContain('@keyframes')
    expect(unscopedRuleLines(scopeThemeCss(custom))).toEqual([])
    expect(custom).toContain('--accent: #113399;')
    expect(custom).toContain('--highlight: #f3b53f;')
    expect(custom).toContain('--decor:')
  })
})
