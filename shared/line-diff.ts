// Line diff for two personality texts. Page diffs (shared/diff.ts) compare blocks, which is the wrong shape here.

export type LineDiffRow =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'remove'; text: string }
  | { kind: 'gap'; count: number; lines: string[] }

interface Edit {
  kind: 'same' | 'add' | 'remove'
  text: string
}

/** Unchanged runs longer than this become one gap the UI can open. */
const GAP_AFTER = 3

function middle(before: string[], after: string[]): Edit[] {
  const n = before.length
  const m = after.length
  // A personality is short. Past this, show the middle as removed then added rather than a huge table.
  if (n * m > 2_000_000) {
    return [...before.map((text) => ({ kind: 'remove' as const, text })), ...after.map((text) => ({ kind: 'add' as const, text }))]
  }
  const next = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = next[i]!
    const below = next[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      row[j] = before[i] === after[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!)
    }
  }
  const out: Edit[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i]! })
      i++
      j++
    } else if (next[i + 1]![j]! >= next[i]![j + 1]!) {
      out.push({ kind: 'remove', text: before[i]! })
      i++
    } else {
      out.push({ kind: 'add', text: after[j]! })
      j++
    }
  }
  while (i < n) out.push({ kind: 'remove', text: before[i++]! })
  while (j < m) out.push({ kind: 'add', text: after[j++]! })
  return out
}

function edits(before: string[], after: string[]): Edit[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const prefix = before.slice(0, start).map((text) => ({ kind: 'same' as const, text }))
  const suffix = before.slice(before.length - end).map((text) => ({ kind: 'same' as const, text }))
  return [...prefix, ...middle(before.slice(start, before.length - end), after.slice(start, after.length - end)), ...suffix]
}

function collapse(rows: Edit[]): LineDiffRow[] {
  const out: LineDiffRow[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i]!.kind !== 'same') {
      out.push(rows[i]!)
      i++
      continue
    }
    let j = i
    while (j < rows.length && rows[j]!.kind === 'same') j++
    const run = rows.slice(i, j).map((row) => row.text)
    if (run.length > GAP_AFTER) out.push({ kind: 'gap', count: run.length, lines: run })
    else for (const text of run) out.push({ kind: 'same', text })
    i = j
  }
  return out
}

/** `before` is the current personality. `after` is the proposal. Both are split on newline. */
export function diffLines(before: string, after: string): LineDiffRow[] {
  return collapse(edits(before.split('\n'), after.split('\n')))
}
