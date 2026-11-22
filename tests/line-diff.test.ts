import { describe, expect, it } from 'vitest'
import { diffLines } from '../shared/line-diff'

describe('diffLines', () => {
  it('marks a replaced line as removed then added, and keeps the neighbours', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('marks a pure addition and a pure removal', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'c' },
    ])
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('leaves three unchanged lines as themselves', () => {
    const rows = diffLines('a\nb\nc\nold', 'a\nb\nc\nnew')
    expect(rows.some((row) => row.kind === 'gap')).toBe(false)
    expect(rows.filter((row) => row.kind === 'same')).toHaveLength(3)
  })

  it('collapses an unchanged run longer than three into a gap that keeps the lines', () => {
    const same = ['keep', 'u1', 'u2', 'u3', 'u4', 'u5']
    const rows = diffLines([...same, 'end'].join('\n'), [...same, 'changed'].join('\n'))
    expect(rows).toEqual([
      { kind: 'gap', count: 6, lines: same },
      { kind: 'remove', text: 'end' },
      { kind: 'add', text: 'changed' },
    ])
  })
})
