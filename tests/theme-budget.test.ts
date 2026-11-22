import { describe, expect, it } from 'vitest'
import { SECTION_CSS_MAX_BYTES, SITE_CSS_MAX_BYTES, STYLE_MAX_BYTES } from '../shared/css/limits'
import {
  BANNER_ACCENT_CSS,
  FOOTER_COLUMNS_CSS,
  HEART_CSS,
  HERO_CAROUSEL_CSS,
  OVER_HERO_CSS,
  THEME_CSS,
  TILE_CSS,
  UTILITY_CSS,
} from '../shared/theme-css'

describe('theme budget', () => {
  it('keeps the theme plus optional shell sheets inside the leftover style budget', () => {
    const budget = STYLE_MAX_BYTES - SITE_CSS_MAX_BYTES - SECTION_CSS_MAX_BYTES
    expect(budget).toBe(24576)
    const total = Buffer.byteLength(
      THEME_CSS + HEART_CSS + UTILITY_CSS + BANNER_ACCENT_CSS + FOOTER_COLUMNS_CSS + OVER_HERO_CSS + TILE_CSS + HERO_CAROUSEL_CSS,
      'utf8',
    )
    expect(total).toBeLessThanOrEqual(budget)
  })
})
