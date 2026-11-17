// Flowbite Vue 0.4 ships a compiled stylesheet whose `dark:` utilities are
// gated on prefers-color-scheme. Tailwind v4 inlines that CSS, so we rewrite
// those blocks after the CSS pipeline so they follow a `.dark` class instead.

export const PREFERS_DARK_MEDIA = '@media (prefers-color-scheme:dark)'
const PREFERS_DARK_MEDIA_SPACED = '@media (prefers-color-scheme: dark)'

function indexOfPrefersDark(css: string, from: number): { at: number; prefix: string } | null {
  const compact = css.indexOf(PREFERS_DARK_MEDIA, from)
  const spaced = css.indexOf(PREFERS_DARK_MEDIA_SPACED, from)
  if (compact < 0 && spaced < 0) return null
  if (spaced < 0 || (compact >= 0 && compact < spaced)) return { at: compact, prefix: PREFERS_DARK_MEDIA }
  return { at: spaced, prefix: PREFERS_DARK_MEDIA_SPACED }
}

export function rewritePrefersColorSchemeDark(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const found = indexOfPrefersDark(css, i)
    if (!found) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, found.at)
    let j = found.at + found.prefix.length
    while (j < css.length && /\s/.test(css[j]!)) j++
    if (css[j] !== '{') {
      out += css.slice(found.at, j)
      i = j
      continue
    }
    let depth = 0
    let k = j
    for (; k < css.length; k++) {
      const ch = css[k]!
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          k++
          break
        }
      }
    }
    const body = css.slice(j + 1, k - 1)
    out += `:where(.dark){${body}}`
    i = k
  }
  return out
}

function isCssId(id: string): boolean {
  const file = (id.split('?')[0] ?? id).replace(/\\/g, '/')
  return file.endsWith('.css') || id.includes('lang.css') || id.includes('type=style')
}

export function flowbiteClassDarkPlugin() {
  return {
    name: 'flowbite-class-dark',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      if (!isCssId(id)) return
      if (!code.includes('prefers-color-scheme')) return
      const next = rewritePrefersColorSchemeDark(code)
      if (next === code) return
      return { code: next, map: null }
    },
    generateBundle(_opts: unknown, bundle: Record<string, { type: string; fileName: string; source: string | Uint8Array }>) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.css')) continue
        const source = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source)
        if (!source.includes('prefers-color-scheme')) continue
        const next = rewritePrefersColorSchemeDark(source)
        if (next !== source) item.source = next
      }
    },
  }
}
