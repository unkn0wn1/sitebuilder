/** Whether a review changes section CSS or site-wide brand CSS. Pure. Looks at raw documents so a field the schema does not know yet is still seen. */

function cssText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : ''
}

function blockCss(doc: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!doc || typeof doc !== 'object') return out
  const blocks = (doc as { blocks?: unknown }).blocks
  if (!Array.isArray(blocks)) return out
  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object') return
    const row = block as { id?: unknown; css?: unknown }
    const id = typeof row.id === 'string' && row.id ? row.id : `#${index}`
    out.set(id, cssText(row.css))
  })
  return out
}

/** True when any block's custom CSS was added, cleared or edited. Removing a section that had CSS counts. */
export function pageCssChanged(before: unknown, after: unknown): boolean {
  const prev = blockCss(before)
  const next = blockCss(after)
  const ids = new Set([...prev.keys(), ...next.keys()])
  for (const id of ids) {
    if ((prev.get(id) ?? '') !== (next.get(id) ?? '')) return true
  }
  return false
}

/** Author text of brand `customCss`. An absent field and a blank field are both empty. */
export function brandCustomCss(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  return cssText((doc as { customCss?: unknown }).customCss)
}

/** True when brand `customCss` differs. An absent field and a blank field are the same. */
export function brandCssChanged(before: unknown, after: unknown): boolean {
  return brandCustomCss(before) !== brandCustomCss(after)
}
