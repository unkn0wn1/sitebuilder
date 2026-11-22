// Section-level diff between two versions of a page, for the review screen ("Show changes").
import type { PageDoc } from './page'

export type BlockChange =
  | { kind: 'added'; blockId: string; type: string }
  | { kind: 'removed'; blockId: string; type: string }
  | { kind: 'changed'; blockId: string; type: string; fields: string[]; cssBefore?: string; cssAfter?: string }
  | { kind: 'moved'; blockId: string; type: string; from: number; to: number }

export interface PageDiff {
  blocks: BlockChange[]
  meta: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** before = the live version (or null for a new page), after = the version under review. */
export function diffPages(before: PageDoc | null, after: PageDoc): PageDiff {
  const blocks: BlockChange[] = []
  const meta: string[] = []
  const prev = new Map((before?.blocks ?? []).map((b, i) => [b.id, { block: b, index: i }]))
  const next = new Map(after.blocks.map((b, i) => [b.id, { block: b, index: i }]))

  // Relative order of blocks present in both, to report real moves rather than shifts.
  const commonBefore = (before?.blocks ?? []).filter((b) => next.has(b.id)).map((b) => b.id)
  const commonAfter = after.blocks.filter((b) => prev.has(b.id)).map((b) => b.id)

  after.blocks.forEach((block, i) => {
    const old = prev.get(block.id)
    if (!old) {
      blocks.push({ kind: 'added', blockId: block.id, type: block.type })
      return
    }
    const fields = [...new Set([...Object.keys(old.block.props), ...Object.keys(block.props)])].filter((k) => !same(old.block.props[k], block.props[k]))
    const cssBefore = old.block.css ?? ''
    const cssAfter = block.css ?? ''
    if (cssBefore !== cssAfter) fields.push('css')
    if (fields.length) {
      blocks.push(cssBefore !== cssAfter ? { kind: 'changed', blockId: block.id, type: block.type, fields, cssBefore, cssAfter } : { kind: 'changed', blockId: block.id, type: block.type, fields })
    }
    if (commonBefore.indexOf(block.id) !== commonAfter.indexOf(block.id)) blocks.push({ kind: 'moved', blockId: block.id, type: block.type, from: old.index, to: i })
  })
  for (const [id, { block }] of prev) if (!next.has(id)) blocks.push({ kind: 'removed', blockId: id, type: block.type })

  if (!before || before.title !== after.title) meta.push('title')
  for (const key of Object.keys(after.seo) as (keyof PageDoc['seo'])[]) if (!before || !same(before.seo[key], after.seo[key])) meta.push(`seo.${key}`)
  return { blocks, meta: before ? meta : ['title'] }
}
