import { describe, expect, it } from 'vitest'
import { contrastRatio, contrastWarning } from '../shared/contrast'
import { brandContrastChecks, defaultBrandDoc, validateBrandDoc } from '../shared/brand'
import { themeCssFromTokens, BUNDLE_ID, DEFAULT_THEME_TOKENS, THEME_CSS } from '../shared/theme-css'

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
    expect(doc.tokens).not.toHaveProperty('logoPill')
    expect(doc.menuStyle).toBe('simple')
    expect(brandContrastChecks(doc).warnings).toEqual([])
    const darkPill = { ...doc, tokens: { ...doc.tokens, logoPill: '#1f1a17' } }
    const pillWarning = brandContrastChecks(darkPill).warnings.find((issue) => issue.path === 'tokens.logoPill')
    expect(pillWarning?.message).toMatch(/Logo text/)
    expect(brandContrastChecks(darkPill).blocking).toEqual([])
    const lightPill = { ...doc, tokens: { ...doc.tokens, logoPill: '#f7f4ef' } }
    expect(brandContrastChecks(lightPill).warnings.find((issue) => issue.path === 'tokens.logoPill')).toBeUndefined()
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

  it('keeps the default theme byte-identical and fills highlight on an old brand doc', () => {
    const fonts = { body: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', heading: null }
    expect(themeCssFromTokens(DEFAULT_THEME_TOKENS)).toBe(THEME_CSS)
    expect(themeCssFromTokens(DEFAULT_THEME_TOKENS, fonts)).toBe(THEME_CSS)
    expect(THEME_CSS).not.toContain('--highlight')
    expect(BUNDLE_ID).toBe('theme-default-4')
    expect(defaultBrandDoc().tokens.highlight).toBe('#f3b53f')

    const { highlight: _highlight, ...without } = DEFAULT_THEME_TOKENS
    void _highlight
    const parsed = validateBrandDoc({ schemaVersion: 1, tokens: without })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.tokens.highlight).toBe('#f3b53f')
    expect(parsed.doc.tokens.ink).toBe(DEFAULT_THEME_TOKENS.ink)
    expect(parsed.doc.tokens).not.toHaveProperty('logoPill')

    for (const logoPill of ['#fff', '#FFF', '#ffffff', '#FFFFFF', '', null]) {
      const white = validateBrandDoc({ schemaVersion: 1, tokens: { ...DEFAULT_THEME_TOKENS, logoPill } })
      expect(white.ok).toBe(true)
      if (!white.ok) return
      expect(white.doc.tokens).not.toHaveProperty('logoPill')
    }
    const chosen = validateBrandDoc({ schemaVersion: 1, tokens: { ...DEFAULT_THEME_TOKENS, logoPill: '#112233' } })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) return
    expect(chosen.doc.tokens.logoPill).toBe('#112233')
  })
})
