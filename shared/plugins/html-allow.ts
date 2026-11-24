// Tags and attributes a plugin template may use. Anything else is rejected at compile time.

export const HTML_TAGS = new Set([
  'section',
  'div',
  'p',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'span',
  'strong',
  'em',
  'small',
  'blockquote',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
  'article',
  'header',
  'br',
  'hr',
  'progress',
])

export const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
])

export const VOID_TAGS = new Set(['br', 'hr'])

const GLOBAL_ATTRS = ['class', 'id', 'aria-hidden', 'aria-label', 'role']

const SVG_ATTRS = [
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'transform',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'focusable',
  'clip-path',
  'class',
  'id',
  'aria-hidden',
  'aria-label',
  'role',
]

const PROGRESS_ATTRS = ['max', 'value', 'aria-label', 'class', 'id', 'role']

/** Attributes whose mustache value must be a number. Literals on the others stay text. */
export const NUMERIC_ATTRS = new Set([
  'max',
  'value',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'stroke-width',
  'stop-opacity',
  'offset',
])

export const CLASS_ID = /^[A-Za-z0-9_:-]{1,64}$/

export const FILL_KEYS = new Set(['hD', 'hM', 'yD', 'yM', 'percent'])

/** `hello-note/Note` and the same shape the manifest already allows. */
export const PLUGIN_STORED_TYPE = /^[a-z][a-z0-9-]{1,31}\/[A-Z][A-Za-z0-9]{0,23}$/

const REJECTED_ATTRS = new Set(['style', 'href', 'src', 'srcset', 'xlink:href', 'formaction'])

/** Lowercase slug of a stored type. `hello-note/Note` becomes `hello-note-note`. */
export function pluginTypeSlug(storedType: string): string {
  const slug = storedType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'block'
}

/** Clip and element ids are prefixed per section so two blocks can share one template. */
export function pluginElementId(blockSlug: string, sectionId: string, localId: string): string {
  return `p${blockSlug}-${sectionId}-${localId}`
}

export function canonicalTag(raw: string, inSvg: boolean): string | null {
  const lower = raw.toLowerCase()
  if (!inSvg) {
    if (HTML_TAGS.has(lower)) return lower
    if (lower === 'svg') return 'svg'
    return null
  }
  for (const tag of SVG_TAGS) {
    if (tag.toLowerCase() === lower) return tag
  }
  return null
}

export function canonicalAttr(tag: string, raw: string): string | null {
  const lower = raw.toLowerCase()
  if (lower.startsWith('on') || REJECTED_ATTRS.has(lower)) return null
  const list = tag === 'progress' ? PROGRESS_ATTRS : SVG_TAGS.has(tag) ? SVG_ATTRS : GLOBAL_ATTRS
  return list.find((item) => item.toLowerCase() === lower) ?? null
}
