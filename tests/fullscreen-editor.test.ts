import { describe, expect, it } from 'vitest'
import { languageSupport, withinMaxLength } from '../app/utils/codemirror'

describe('languageSupport', () => {
  it('returns an extension for markdown and css, and none for text', () => {
    const markdown = languageSupport('markdown')
    const css = languageSupport('css')
    expect(markdown).toBeTruthy()
    expect(css).toBeTruthy()
    expect(markdown).not.toBe(css)
    expect(languageSupport('text')).toBeNull()
  })
})

describe('withinMaxLength', () => {
  it('blocks past the cap and allows edits under it', () => {
    expect(withinMaxLength('abcd', 3)).toBe(false)
    expect(withinMaxLength('abc', 3)).toBe(true)
    expect(withinMaxLength('ab', 3)).toBe(true)
    expect(withinMaxLength('', 0)).toBe(true)
    expect(withinMaxLength('a', 0)).toBe(false)
    expect(withinMaxLength('anything', undefined)).toBe(true)
  })
})
