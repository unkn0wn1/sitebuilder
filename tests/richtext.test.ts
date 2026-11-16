import { describe, expect, it } from 'vitest'
import { isSafeHref, renderRichText, richTextDoc } from '../shared/richtext'

describe('rich text', () => {
  it('accepts the small structured format', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Give', marks: [{ type: 'link', href: 'https://example.org' }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      ],
    }
    expect(richTextDoc.safeParse(doc).success).toBe(true)
  })

  it('rejects raw HTML nodes, unknown nodes and h1', () => {
    expect(richTextDoc.safeParse({ type: 'doc', content: [{ type: 'html', html: '<script>alert(1)</script>' }] }).success).toBe(false)
    expect(richTextDoc.safeParse({ type: 'doc', content: [{ type: 'heading', level: 1, content: [] }] }).success).toBe(false)
  })

  it('rejects javascript: and data: links', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', '//evil.example', 'vbscript:x']) {
      expect(isSafeHref(href)).toBe(false)
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', href }] }] }] }
      expect(richTextDoc.safeParse(doc).success).toBe(false)
    }
    for (const href of ['https://a.org', 'mailto:a@b.org', 'tel:+44123', '/about', '#donate']) expect(isSafeHref(href)).toBe(true)
  })

  it('escapes text when rendering', () => {
    const html = renderRichText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)> & "q"' }] }] })
    expect(html).toBe('<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;</p>')
  })
})
