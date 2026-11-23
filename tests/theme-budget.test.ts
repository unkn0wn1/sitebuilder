import { describe, expect, it } from 'vitest'
import { BLOCK_CSS_MAX_BYTES, SECTION_CSS_MAX_BYTES, SHELL_CSS_MAX_BYTES, SITE_CSS_MAX_BYTES, STYLE_MAX_BYTES } from '../shared/css/limits'
import {
  BANNER_ACCENT_CSS,
  FOOTER_COLUMNS_CSS,
  HEART_CSS,
  HERO_CAROUSEL_CSS,
  OVER_HERO_CSS,
  THEME_CSS,
  PICKER_CSS,
  THERMOMETER_CSS,
  TILE_CSS,
  UTILITY_CSS,
} from '../shared/theme-css'

describe('theme budget', () => {
  it('keeps shell sheets, block sheets and a full page inside their own caps', () => {
    // The shell cap is not STYLE_MAX - site - section. That subtraction now includes the block allowance.
    expect(SHELL_CSS_MAX_BYTES).toBe(24576)
    expect(BLOCK_CSS_MAX_BYTES).toBe(10240)
    expect(STYLE_MAX_BYTES).toBe(SHELL_CSS_MAX_BYTES + SITE_CSS_MAX_BYTES + SECTION_CSS_MAX_BYTES + BLOCK_CSS_MAX_BYTES)
    const shell = Buffer.byteLength(
      THEME_CSS + HEART_CSS + UTILITY_CSS + BANNER_ACCENT_CSS + FOOTER_COLUMNS_CSS + OVER_HERO_CSS + TILE_CSS + HERO_CAROUSEL_CSS,
      'utf8',
    )
    const blocks = Buffer.byteLength(THERMOMETER_CSS + PICKER_CSS, 'utf8')
    expect(shell).toBeLessThanOrEqual(SHELL_CSS_MAX_BYTES)
    expect(blocks).toBeLessThanOrEqual(BLOCK_CSS_MAX_BYTES)
    expect(shell + blocks + SITE_CSS_MAX_BYTES + SECTION_CSS_MAX_BYTES).toBeLessThanOrEqual(STYLE_MAX_BYTES)
  })
})
