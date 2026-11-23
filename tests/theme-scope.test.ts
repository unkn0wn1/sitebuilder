import { describe, expect, it } from 'vitest'
import { scopeThemeCss, scopedDonatePreviewCss, scopedHeroCarouselCss, scopedPickerCss, scopedRhythmCss, scopedThermometerCss } from '../app/utils/theme-css'
import { DEFAULT_THEME_TOKENS, DONATE_PREVIEW_CSS, HERO_CAROUSEL_CSS, PICKER_CSS, RHYTHM_CSS, THEME_CSS, THERMOMETER_CSS, themeCssFromTokens } from '../shared/theme-css'

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

  it('scopes the carousel sheet, with no keyframes', () => {
    expect(HERO_CAROUSEL_CSS).not.toContain('@keyframes')
    const scoped = scopedHeroCarouselCss()
    expect(scoped).toBe(scopeThemeCss(HERO_CAROUSEL_CSS))
    expect(scoped).not.toContain('@keyframes')
    expect(unscopedRuleLines(scoped)).toEqual([])
    expect(scoped).toContain('.sb-canvas')
  })

  it('scopes the thermometer sheet, with no keyframes or animation', () => {
    expect(THERMOMETER_CSS).not.toContain('@keyframes')
    expect(THERMOMETER_CSS).not.toContain('animation')
    const scoped = scopedThermometerCss()
    expect(scoped).toBe(scopeThemeCss(THERMOMETER_CSS))
    expect(unscopedRuleLines(scoped)).toEqual([])
    expect(scoped).toContain('.sb-canvas .th')
  })

  it('scopes the gift picker sheet, with no keyframes', () => {
    expect(PICKER_CSS).not.toContain('@keyframes')
    const scoped = scopedPickerCss()
    expect(scoped).toBe(scopeThemeCss(PICKER_CSS))
    expect(unscopedRuleLines(scoped)).toEqual([])
    expect(scoped).toContain('.sb-canvas .ga')
  })

  it('scopes the donate preview and section rhythm sheets, with no keyframes', () => {
    expect(DONATE_PREVIEW_CSS).not.toContain('@keyframes')
    expect(RHYTHM_CSS).not.toContain('@keyframes')
    const donate = scopedDonatePreviewCss()
    const rhythm = scopedRhythmCss()
    expect(donate).toBe(scopeThemeCss(DONATE_PREVIEW_CSS))
    expect(rhythm).toBe(scopeThemeCss(RHYTHM_CSS))
    expect(unscopedRuleLines(donate)).toEqual([])
    expect(unscopedRuleLines(rhythm)).toEqual([])
    expect(donate).toContain('.sb-canvas .donate-preview')
    expect(rhythm).toContain('.sb-canvas .bg-card')
    expect(rhythm).toContain('.sb-canvas .bg-warm')
  })
})
