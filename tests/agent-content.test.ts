import { describe, expect, it } from 'vitest'
import {
  findLinks,
  hrefMatches,
  insertRichText,
  markdownToRichText,
  removeLinks,
  replaceLinks,
  replaceText,
  richTextToMarkdown,
  searchText,
  textLeaves,
  wordsChanged,
  domainOfHref,
  linkDelta,
} from '../shared/agent/content'
import { richTextFromParagraphs, type RichTextDoc } from '../shared/richtext'

const doc = (...content: RichTextDoc['content']): RichTextDoc => ({ type: 'doc', content })
const withLink: RichTextDoc = doc({ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'text', text: 'our partner', marks: [{ type: 'bold' }, { type: 'link', href: 'https://Old.example.org/page/' }] }, { type: 'text', text: ' now.' }] })

describe('text', () => {
  it('finds text in rich text and in text props, and ignores other props', () => {
    const props = { heading: 'Call 0161 496 0000', amount: '0161 496 0000', content: richTextFromParagraphs(['Phone 0161 496 0000 today']) }
    const leaves = textLeaves(props)
    expect(leaves.map((l) => l.kind)).toEqual(['prop', 'rich'])
    expect(searchText(props, '0161 496 0000').length).toBe(2)
  })

  it('replaces inside runs, keeps formatting, and counts', () => {
    const r = replaceText({ heading: 'Hello world', content: withLink }, 'our partner', 'the partner')
    expect(r.replacements).toHaveLength(1)
    expect(JSON.stringify(r.value)).toContain('the partner')
    expect(JSON.stringify(r.value)).toContain('"bold"')
    expect(JSON.stringify(r.value)).toContain('Old.example.org')
  })

  it('is case-sensitive by default, and honours whole words', () => {
    expect(replaceText({ heading: 'Cat food' }, 'cat', 'dog').replacements).toHaveLength(0)
    expect(replaceText({ heading: 'Cat category' }, 'cat', 'dog', { caseSensitive: false, wholeWord: true }).value.heading).toBe('dog category')
  })

  it('drops a run that becomes empty and counts words changed', () => {
    const r = replaceText({ content: richTextFromParagraphs(['Remove me']) }, 'Remove me', '')
    expect(JSON.stringify(r.value)).not.toContain('Remove')
    expect(wordsChanged(richTextFromParagraphs(['one two three']), richTextFromParagraphs(['one two four']))).toBeGreaterThan(0)
  })
})

describe('links', () => {
  it('finds rich-text marks, buttons, menu targets and social links once each', () => {
    const block = { heading: 'x', content: withLink, cta: { label: 'Go', href: 'https://old.example.org/page' } }
    const hits = findLinks(block, 'block')
    expect(hits.map((h) => h.kind).sort()).toEqual(['button', 'text_link'])
    const part = findLinks({ items: [{ id: 'b_1', label: 'A', target: { type: 'url', url: 'https://old.example.org/page' }, children: [] }], social: [{ network: 'x', url: 'https://x.com/a' }] }, 'sitepart')
    expect(part.map((h) => h.kind).sort()).toEqual(['menu_target', 'social'])
  })

  it('matches addresses exactly, by prefix and by domain, ignoring scheme, www and slash', () => {
    expect(hrefMatches('http://www.Old.example.org/page/', 'https://old.example.org/page')).toBe(true)
    expect(hrefMatches('https://old.example.org/page/two', 'https://old.example.org/page')).toBe(false)
    expect(hrefMatches('https://old.example.org/page/two', 'https://old.example.org/page', 'prefix')).toBe(true)
    expect(hrefMatches('https://old.example.org/anything', 'old.example.org', 'domain')).toBe(true)
    expect(hrefMatches('https://old.example.org/anything', 'https://old.example.org/', 'domain')).toBe(true)
    expect(hrefMatches('https://notold.example.org/', 'old.example.org', 'domain')).toBe(false)
    expect(hrefMatches('/about', 'https://site.org/about', 'exact', 'https://site.org')).toBe(true)
  })

  it('removes a text link but keeps its words and other formatting', () => {
    const hits = findLinks({ content: withLink }, 'block')
    const r = removeLinks({ content: withLink }, hits)
    expect(r.removed).toHaveLength(1)
    const out = JSON.stringify(r.value)
    expect(out).not.toContain('link')
    expect(out).toContain('our partner')
    expect(out).toContain('bold')
  })

  it('removes an optional button, and reports one a list cannot lose', () => {
    const hits = findLinks({ cta: { label: 'Go', href: 'https://old.example.org/' } }, 'block')
    expect(removeLinks({ cta: { label: 'Go', href: 'https://old.example.org/' } }, hits).value).toEqual({})
    const menu = { items: [{ id: 'b_1', label: 'A', target: { type: 'url', url: 'https://old.example.org/' }, children: [{ id: 'b_2', label: 'B', target: { type: 'url', url: '/b' } }] }] }
    const r = removeLinks(menu, findLinks(menu, 'sitepart'))
    expect(r.unremovable).toHaveLength(1)
    expect(r.unremovable[0]!.reason).toMatch(/sub-items/)
  })

  it('replaces addresses and turns a page target into an address', () => {
    const r = replaceLinks({ cta: { label: 'Go', href: 'https://old.example.org/' } }, findLinks({ cta: { label: 'Go', href: 'https://old.example.org/' } }, 'block'), 'https://new.example.org/')
    expect(r.value.cta.href).toBe('https://new.example.org/')
    expect(r.value.cta.label).toBe('Go')
  })

  it('describes where links go, and what a change adds and removes', () => {
    expect(domainOfHref('https://www.good.example/x')).toBe('good.example')
    expect(domainOfHref('/about')).toBe('(this site)')
    expect(domainOfHref('mailto:a@b.c')).toBe('mailto')
    const d = linkDelta({ a: { label: 'x', href: 'https://a.example/' } }, { a: { label: 'x', href: 'https://b.example/' } }, 'block')
    expect(d).toEqual({ linksAdded: 1, linksRemoved: 1, newLinkDomains: ['b.example'] })
  })
})

describe('markdown', () => {
  it('converts paragraphs, headings, lists, bold, italic and links, and back', () => {
    const md = '## Cookies\n\nWe use **one** cookie from [Plausible](https://plausible.io).\n\n- first\n- second\n\n1. one\n2. two'
    const r = markdownToRichText(md)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList'])
    expect(richTextToMarkdown(r.doc)).toContain('[Plausible](https://plausible.io)')
    expect(richTextToMarkdown(r.doc)).toContain('**one**')
  })

  it('refuses unsafe links and HTML-looking input it cannot represent', () => {
    expect(markdownToRichText('[x](javascript:alert(1))').ok).toBe(false)
  })

  it('inserts at the start, end, or after some words', () => {
    const base = richTextFromParagraphs(['First paragraph.', 'Second paragraph.'])
    const add = richTextFromParagraphs(['Added.'])
    const text = (d: RichTextDoc | null) => (d ? richTextToMarkdown(d).split('\n\n') : null)
    expect(text(insertRichText(base, add, 'end'))).toEqual(['First paragraph.', 'Second paragraph.', 'Added.'])
    expect(text(insertRichText(base, add, 'start'))![0]).toBe('Added.')
    expect(text(insertRichText(base, add, { afterText: 'First' }))).toEqual(['First paragraph.', 'Added.', 'Second paragraph.'])
    expect(insertRichText(base, add, { afterText: 'nowhere' })).toBeNull()
  })
})
