import { describe, expect, it } from 'vitest'
import { CssRejected, sanitizeCss } from '../shared/css/sanitize'

const ID = 'b_hero1'
const OTHER = 'b_other1'

function emit(css: string, sectionId = ID) {
  return sanitizeCss(css, { scope: 'section', sectionId, mode: 'emit' })
}

describe('section CSS prefixer', () => {
  it('scopes every selector and leaves :is arguments alone', () => {
    expect(emit('.a, .b { color: red }')).toContain('[data-sb-css="b_hero1"] .a,[data-sb-css="b_hero1"] .b')
    expect(emit('.a::before { content: "x" }')).toContain('[data-sb-css="b_hero1"] .a::before')
    expect(emit('.a:is(.b, .c) { color: red }')).toContain('[data-sb-css="b_hero1"] .a:is(.b,.c)')
    expect(emit('.a:where(.b) { color: red }')).not.toContain(':where([data-sb-css')
    expect(emit('.a:not(.b) { color: red }')).toContain(':not(.b)')
    expect(emit('.a:has(.b) { color: red }')).toContain(':has(.b)')
    expect(emit('.a + .b { color: red }')).toContain('[data-sb-css="b_hero1"] .a+.b')
    expect(emit('.a ~ .b { color: red }')).toContain('[data-sb-css="b_hero1"] .a~.b')
  })

  it('maps :root, html, body and & onto the section, and keeps extra classes', () => {
    expect(emit(':root { color: red }')).toContain('[data-sb-css="b_hero1"]{color:red}')
    expect(emit('html { margin: 0 }')).toContain('[data-sb-css="b_hero1"]{margin:0}')
    expect(emit('body.theme:hover { color: red }')).toContain('[data-sb-css="b_hero1"].theme:hover')
    expect(emit('body .foo { color: blue }')).toContain('[data-sb-css="b_hero1"] .foo')
    expect(emit('body > .wrap { padding: 1px }')).toContain('[data-sb-css="b_hero1"]>.wrap')
    expect(emit('& { background: #f6f1ea }')).toContain('[data-sb-css="b_hero1"]{background:#f6f1ea}')
    expect(emit('&:hover { color: red }')).toContain('[data-sb-css="b_hero1"]:hover')
  })

  it('rejects a root followed by a sibling combinator', () => {
    for (const css of ['body + .next { color: red }', ':root ~ .next { color: red }', 'html + .next { color: red }', '& + .next { color: red }']) {
      expect(() => emit(css)).toThrow(CssRejected)
      try {
        emit(css)
      } catch (error) {
        expect((error as CssRejected).message).toBe('This selector would style outside the section.')
      }
    }
  })

  it('prefixes inside media, supports and container, and keeps a nested &', () => {
    expect(emit('@media (min-width: 40rem) { .a { color: red } }')).toContain('@media (min-width:40rem){[data-sb-css="b_hero1"] .a{color:red}}')
    expect(emit('@supports (display: grid) { .b { color: blue } }')).toContain('[data-sb-css="b_hero1"] .b')
    expect(emit('@container sidebar (min-width: 20rem) { .card { color: red } }')).toContain('@container sidebar')
    const nested = emit('.wrap { color: red; & .inner { color: blue } &:hover { color: green } }')
    expect(nested).toContain('[data-sb-css="b_hero1"] .wrap')
    expect(nested).toContain('& .inner')
    expect(nested).toContain('&:hover')
  })

  it('prefixes keyframe names and animation references, including names from outside the sheet', () => {
    const css = '@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .a { animation: 1s ease-in-out fade, 2s linear slide; animation-name: fade, none }'
    const out = emit(css)
    expect(out).toContain('@keyframes b_hero1__fade')
    expect(out).toContain('from{opacity:0}')
    expect(out).not.toContain('[data-sb-css="b_hero1"] from')
    expect(out).toContain('b_hero1__fade')
    expect(out).toContain('b_hero1__slide')
    expect(out).toContain('ease-in-out')
    expect(out).toContain('linear')
    expect(out).toContain('none')
    expect(out).not.toContain('animation-name:fade')
    const other = emit(css, OTHER)
    expect(other).toContain('@keyframes b_other1__fade')
    expect(other).not.toContain('b_hero1')
    expect(sanitizeCss(css, { scope: 'section', mode: 'check' })).toBe(css)
    expect(emit('.a { animation-name: missing }')).toContain('animation-name:b_hero1__missing')
  })

  it('does not prefix site-wide keyframes or selectors', () => {
    const css = '@keyframes fade { from { opacity: 0 } to { opacity: 1 } } a { animation-name: fade }'
    const out = sanitizeCss(css, { scope: 'site', mode: 'emit' })
    expect(out).toContain('@keyframes fade')
    expect(out).toContain('animation-name:fade')
    expect(out).not.toContain('data-sb-css')
    expect(out).not.toContain('b_hero1')
  })

  it('keeps a same-site image url unquoted and escapes a less-than that the generator would emit', () => {
    const out = emit('a { background: url(/media/med_00000000000000000000000001-1280.webp) }')
    expect(out).toContain('url(/media/med_00000000000000000000000001-1280.webp)')
    expect(out).not.toContain('<')
    const escaped = emit('a { content: "\\3c script" }')
    expect(escaped).not.toContain('<')
    expect(escaped).toContain('\\3c ')
  })
})
