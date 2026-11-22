import { describe, expect, inject, it } from 'vitest'

const baseUrl = inject('baseUrl')

function scriptNonces(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => {
    const found = /\bnonce="([^"]*)"/.exec(match[1] ?? '')
    return found?.[1] ?? ''
  })
}

describe('builder CSP', () => {
  it('nonces scripts on an HTML page and leaves API responses alone', async () => {
    const first = await fetch(`${baseUrl}/login`)
    const second = await fetch(`${baseUrl}/login`)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toContain('text/html')
    const csp = first.headers.get('content-security-policy') ?? ''
    const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1] ?? ''
    expect(nonce).not.toBe('')
    expect(csp).toBe(
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`,
    )
    expect(first.headers.get('x-content-type-options')).toBe('nosniff')
    expect(first.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    const html = await first.text()
    const nonces = scriptNonces(html)
    expect(nonces.length).toBeGreaterThan(0)
    expect(nonces.every((value) => value === nonce)).toBe(true)
    const other = /script-src 'self' 'nonce-([^']+)'/.exec(second.headers.get('content-security-policy') ?? '')?.[1]
    expect(other).toBeTruthy()
    expect(other).not.toBe(nonce)

    for (const path of ['/api/health', '/api/v1/health']) {
      const res = await fetch(`${baseUrl}${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('json')
      expect(res.headers.get('content-security-policy')).toBeNull()
      expect(res.headers.get('x-content-type-options')).toBeNull()
      expect(res.headers.get('referrer-policy')).toBeNull()
      expect(await res.json()).toEqual({ ok: true })
    }
  })
})
