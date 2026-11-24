// Production builder pages get a per-request script nonce and a Content-Security-Policy.
// nuxt dev leaves NODE_ENV unset as production, so the dev server does not send this.
import { randomBytes } from 'node:crypto'
import { demoMode } from '../services/demo-mode'
import { builderCsp, stampScriptNonces } from '../utils/builder-csp'

function headerValue(headers: Record<string, unknown>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  const value = found?.[1]
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : ''
}

function skipPath(path: string): boolean {
  const bare = path.split('?')[0] ?? ''
  return bare === '/api' || bare.startsWith('/api/') || bare === '/agent' || bare.startsWith('/agent/')
}

async function readHtmlBody(body: unknown): Promise<string | null> {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const chunks: Buffer[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  return null
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (response, context) => {
    if (process.env.NODE_ENV !== 'production') return
    const path = context.event.path ?? ''
    if (skipPath(path)) return
    const headers = (response.headers ??= {}) as Record<string, unknown>
    if (!headerValue(headers, 'content-type').toLowerCase().includes('text/html')) return
    try {
      const html = await readHtmlBody(response.body)
      if (html == null) {
        console.error(JSON.stringify({ level: 'error', msg: 'builder_csp_skipped', reason: 'unreadable_body', path }))
        return
      }
      const nonce = randomBytes(16).toString('base64')
      response.body = stampScriptNonces(html, nonce)
      headers['content-security-policy'] = builderCsp(nonce, { turnstile: demoMode() })
      headers['x-content-type-options'] = 'nosniff'
      headers['referrer-policy'] = 'strict-origin-when-cross-origin'
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'builder_csp', path, error: String(error) }))
    }
  })
})
