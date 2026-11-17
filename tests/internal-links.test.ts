import { describe, expect, it } from 'vitest'
import { collectLinkedPageIds, internalSitePath, pageIdByPath, pageIdForHref, pathAliases } from '../shared/internal-links'

describe('internal site links', () => {
  it('keeps site paths and same-origin URLs, and ignores the rest', () => {
    expect(internalSitePath('/about-us')).toBe('/about-us')
    expect(internalSitePath('/about-us/')).toBe('/about-us')
    expect(internalSitePath('/')).toBe('/')
    expect(internalSitePath('https://example.org/about-us', 'https://example.org')).toBe('/about-us')
    expect(internalSitePath('https://other.org/about-us', 'https://example.org')).toBeNull()
    expect(internalSitePath('#donate')).toBeNull()
    expect(internalSitePath('mailto:hi@example.org')).toBeNull()
    expect(internalSitePath('tel:+441234')).toBeNull()
    expect(internalSitePath('//evil.example/x')).toBeNull()
  })

  it('collects page ids from hrefs and page targets', () => {
    const pages = pageIdByPath({ pg_about: { path: '/about-us' }, pg_home: { path: '/' } })
    expect(pageIdForHref('/about-us', pages)).toBe('pg_about')
    const ids = collectLinkedPageIds(
      {
        blocks: [
          { type: 'CallToAction', props: { button: { label: 'About', href: '/about-us' } } },
          { type: 'RichText', props: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Home', marks: [{ type: 'link', href: 'https://example.org/' }] }] }] } } },
        ],
        items: [{ label: 'About', target: { type: 'page', pageId: 'pg_about' } }],
      },
      pages,
      'https://example.org',
    )
    expect(ids.sort()).toEqual(['pg_about', 'pg_home'])
  })

  it('still finds a page after its address changes, via the old path', () => {
    const previous = { pg_about: { path: '/about-us' } }
    const next = { pg_about: { path: '/who-we-are' } }
    const aliases = pathAliases(previous, next)
    const pages = pageIdByPath(next)
    expect(pageIdForHref('/who-we-are', pages)).toBe('pg_about')
    expect(pageIdForHref('/about-us', pages, null, aliases)).toBe('pg_about')
    expect(collectLinkedPageIds({ button: { href: '/about-us' } }, pages, null, aliases)).toEqual(['pg_about'])
  })
})
