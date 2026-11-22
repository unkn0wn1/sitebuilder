import { describe, expect, it } from 'vitest'
import { builderCsp, stampScriptNonces } from '../server/utils/builder-csp'

describe('builder CSP', () => {
  it('stamps a nonce onto script tags and builds the production policy', () => {
    const nonce = 'abc+/=de'
    const html = stampScriptNonces(
      '<script>var x=1</script><SCRIPT type="module" src="/_nuxt/a.js"></SCRIPT><script nonce="keep">2</script>',
      nonce,
    )
    expect(html).toBe(
      `<script nonce="${nonce}">var x=1</script><script nonce="${nonce}" type="module" src="/_nuxt/a.js"></SCRIPT><script nonce="keep">2</script>`,
    )
    const csp = builderCsp(nonce)
    expect(csp).toBe(
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`,
    )
  })
})
