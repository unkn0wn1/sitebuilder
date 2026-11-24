/** Production CSP for the builder HTML shell. The nonce is new on every response. */
export function builderCsp(nonce: string, opts?: { turnstile?: boolean }): string {
  const turnstile = opts?.turnstile ? ' https://challenges.cloudflare.com' : ''
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}'${turnstile}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'${turnstile}; frame-src 'self'${turnstile}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`
}

/** Add nonce to each script tag that does not already have one. */
export function stampScriptNonces(html: string, nonce: string): string {
  return html.replace(/<script\b([^>]*)>/gi, (full, attrs: string) => {
    if (/\bnonce\s*=/i.test(attrs)) return full
    return `<script nonce="${nonce}"${attrs}>`
  })
}
