// WCAG 2 contrast between two hex colours. Used by Brand and Design.
function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const v = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const n = Number.parseInt(v, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio of two hex colours, 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastWarning(label: string, ratio: number, min: number): string | null {
  if (ratio + 1e-6 >= min) return null
  const got = Math.round(ratio * 10) / 10
  return `${label} is ${got}:1. Aim for at least ${min}:1 so it stays readable.`
}
