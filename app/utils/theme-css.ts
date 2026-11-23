// Scope the public theme so it only paints the canvas, not the builder chrome.
import { HERO_CAROUSEL_CSS, PICKER_CSS, THEME_CSS, THERMOMETER_CSS } from '#shared/theme-css'

export const CANVAS_SCOPE = 'sb-canvas'

export function scopeThemeCss(css: string = THEME_CSS, scope = `.${CANVAS_SCOPE}`): string {
  const out: string[] = []
  for (const line of css.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('@') || trimmed.startsWith('}') || trimmed.length === 0) {
      out.push(line)
      continue
    }
    if (trimmed.startsWith(':root')) {
      out.push(line.replace(':root', scope))
      continue
    }
    const match = line.match(/^(\s*)([^@{]+)(\{.*)$/)
    if (match) {
      const [, indent = '', raw = '', rest = ''] = match
      const parts = raw.split(',').map((s) => {
        const sel = s.trim()
        if (!sel) return sel
        if (sel === 'html' || sel === 'body' || sel === 'html, body') return scope
        return `${scope} ${sel}`
      })
      out.push(`${indent}${parts.join(', ')} ${rest}`)
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

export const SCOPED_THEME_CSS = scopeThemeCss()

/** Carousel rules for the editor frame, scoped so they paint only inside .sb-canvas. */
export function scopedHeroCarouselCss(): string {
  return scopeThemeCss(HERO_CAROUSEL_CSS)
}

/** Thermometer rules for the editor frame, scoped so they paint only inside .sb-canvas. */
export function scopedThermometerCss(): string {
  return scopeThemeCss(THERMOMETER_CSS)
}

/** Gift picker rules for the editor frame, scoped so they paint only inside .sb-canvas. */
export function scopedPickerCss(): string {
  return scopeThemeCss(PICKER_CSS)
}
