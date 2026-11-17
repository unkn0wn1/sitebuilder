import { describe, expect, it } from 'vitest'
import { contrastRatio, contrastWarning } from '../shared/contrast'
import { brandContrastChecks, defaultBrandDoc } from '../shared/brand'
import { themeCssFromTokens, DEFAULT_THEME_TOKENS, THEME_CSS } from '../shared/theme-css'

describe('contrast', () => {
  it('gives black on white 21:1 and warns when a pair is too faint', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastWarning('Body text', 2.1, 4.5)).toMatch(/2\.1:1/)
    expect(contrastWarning('Body text', 7, 4.5)).toBeNull()
  })
})

describe('brand pack', () => {
  it('starts from the default theme tokens and warns about a faint body colour', () => {
    const doc = defaultBrandDoc()
    expect(doc.tokens).toEqual(DEFAULT_THEME_TOKENS)
    expect(doc.menuStyle).toBe('simple')
    expect(brandContrastChecks(doc).warnings).toEqual([])
    const faint = { ...doc, tokens: { ...doc.tokens, ink: '#eee8e0' } }
    expect(brandContrastChecks(faint).warnings[0]?.message).toMatch(/Body text/)
  })

  it('builds CSS that still includes the default rules and the chosen colours', () => {
    const css = themeCssFromTokens({ ...DEFAULT_THEME_TOKENS, accent: '#113399' })
    expect(css).toContain('--accent: #113399;')
    expect(css).toContain('.site-header')
    expect(css).toContain('.nav-hamburger')
    expect(THEME_CSS).toContain('--accent: #b5471d;')
  })
})
