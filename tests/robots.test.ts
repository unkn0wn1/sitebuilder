import { describe, expect, it } from 'vitest'
import { defaultRobotsTxt, renderRobotsTxt, sanitizeRobotsTxt } from '../shared/robots'

describe('robots.txt', () => {
  it('offers a safe default and appends a sitemap when indexing is on', () => {
    expect(defaultRobotsTxt('https://sb-demo.moejo.co')).toBe('User-agent: *\nAllow: /\nSitemap: https://sb-demo.moejo.co/sitemap.xml\n')
    expect(renderRobotsTxt({ allowIndexing: true, origin: 'https://example.org' })).toContain('Sitemap: https://example.org/sitemap.xml')
    expect(renderRobotsTxt({ allowIndexing: true, origin: null })).toContain('Sitemap: /sitemap.xml')
  })

  it('always serves Disallow: / when indexing is off, even if custom text would allow crawling', () => {
    const custom = 'User-agent: *\nAllow: /\n'
    expect(renderRobotsTxt({ allowIndexing: false, origin: 'https://example.org', custom })).toBe('User-agent: *\nDisallow: /\n')
    expect(renderRobotsTxt({ allowIndexing: false, custom: 'User-agent: *\nDisallow: /secret\n' })).toBe('User-agent: *\nDisallow: /\n')
  })

  it('accepts allow-listed directives, rejects HTML and unknown directives, and adds a missing Sitemap line', () => {
    const ok = sanitizeRobotsTxt('User-agent: *\nDisallow: /drafts\n# notes\nCrawl-delay: 10\n')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.text).toContain('Disallow: /drafts')

    expect(sanitizeRobotsTxt('User-agent: *\nDisallow: /<script>').ok).toBe(false)
    expect(sanitizeRobotsTxt('User-agent: *\nWeird: yes').ok).toBe(false)
    expect(sanitizeRobotsTxt('just a line').ok).toBe(false)

    const rendered = renderRobotsTxt({
      allowIndexing: true,
      origin: 'https://example.org',
      custom: 'User-agent: *\nDisallow: /drafts\n',
    })
    expect(rendered).toContain('Disallow: /drafts')
    expect(rendered).toContain('Sitemap: https://example.org/sitemap.xml')

    const withSitemap = renderRobotsTxt({
      allowIndexing: true,
      origin: 'https://example.org',
      custom: 'User-agent: *\nAllow: /\nSitemap: https://example.org/sitemap.xml\n',
    })
    expect(withSitemap.match(/^Sitemap:/gim)).toHaveLength(1)
  })
})
