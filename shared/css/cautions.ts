// Warnings for custom CSS that can cover the page or hide something. The same words for a section and the brand.
import type { FieldIssue } from '../issues'

export function cssCautionWarnings(css: string, path: string): FieldIssue[] {
  if (!css.trim()) return []
  const warnings: FieldIssue[] = []
  if (/position\s*:\s*fixed/i.test(css)) warnings.push({ path, message: 'This CSS uses position: fixed, so it can cover other parts of the page.' })
  if (/display\s*:\s*none/i.test(css) || /visibility\s*:\s*hidden/i.test(css) || /opacity\s*:\s*0(?![0-9.])/i.test(css)) {
    warnings.push({ path, message: 'This CSS hides something (display: none, visibility: hidden or opacity: 0).' })
  }
  return warnings
}
