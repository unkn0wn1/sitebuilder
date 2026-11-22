// Preview injection only. Kept off the sanitiser import so the canvas does not load it until a buffer is applied.

/** True when the open preview should gain a temporary style for this buffer. */
export function shouldInjectLiveCss(shown: string, live: { css: string } | null): boolean {
  if (!live?.css.trim()) return false
  return live.css !== shown
}
