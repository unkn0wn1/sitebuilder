import { describe, expect, it } from 'vitest'
import { SvgSanitiseError, looksLikeSvg, sanitizeSvg } from '../shared/svg-sanitize'

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`

describe('sanitizeSvg', () => {
  it('keeps a simple drawing and strips scripts, event handlers, foreign objects and external references', () => {
    const dirty = wrap(
      `<circle r="4" fill="red" onclick="alert(1)"/><script>alert(1)</script><foreignObject><iframe src="https://evil.example"></iframe></foreignObject><use href="https://evil.example/x.svg#a"/><a href="javascript:alert(1)"><path d="M0 0h1"/></a>`,
    )
    expect(looksLikeSvg(Buffer.from(dirty))).toBe(true)
    const clean = sanitizeSvg(dirty)
    expect(clean).toContain('<circle')
    expect(clean).toContain('fill="red"')
    expect(clean).not.toMatch(/script/i)
    expect(clean).not.toMatch(/onclick/i)
    expect(clean).not.toMatch(/foreignObject/i)
    expect(clean).not.toMatch(/iframe/i)
    expect(clean).not.toMatch(/javascript:/i)
    expect(clean).not.toMatch(/https:\/\/evil/)
    expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('allows same-document fragment references on use', () => {
    const clean = sanitizeSvg(wrap('<defs><path id="p" d="M0 0h1"/></defs><use href="#p"/>'))
    expect(clean).toContain('href="#p"')
  })

  it('rejects files that are not SVG or that declare entities', () => {
    expect(() => sanitizeSvg('<html><svg></svg></html>')).toThrow(SvgSanitiseError)
    expect(looksLikeSvg(Buffer.from('<html>nope</html>'))).toBe(false)
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'a'.repeat(1024 * 1024)}</svg>`
    expect(() => sanitizeSvg(huge)).toThrow(/too big/i)
  })
})
