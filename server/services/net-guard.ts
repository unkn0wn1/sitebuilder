// Guards for any request the server makes to an address someone typed (agent alerts, photo imports).
// HTTPS only, no credentials in the address, no private, loopback or link-local destinations. The resolved addresses
// are checked again just before connecting, so a name that later points inside the network is refused. Callers must
// not follow redirects without checking each hop again (see followSafely).
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { AppError } from './errors'

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (kind === 6) {
    const v = ip.toLowerCase()
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('2001:db8')
  }
  return true
}

/** Checks an address someone typed. Returns the cleaned URL (no #fragment). Throws validation_failed with a plain reason. */
export function checkPublicUrl(raw: string, opts: { allowHttp?: boolean; example?: string; credentialsHint?: string; field?: string } = {}): string {
  const field = opts.field ?? 'url'
  const bad = (message: string) => new AppError('validation_failed', message, [{ path: field, message }])
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw bad(`That is not a web address. It should look like ${opts.example ?? 'https://example.org/path'}.`)
  }
  const allowHttp = !!opts.allowHttp
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw bad('Use an https:// address.')
  if (u.username || u.password) throw bad(`Do not put a user name or password in the address.${opts.credentialsHint ?? ''}`)
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!allowHttp) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw bad('That address points inside this network. Use a public address.')
    if (isIP(host) && isPrivateAddress(host)) throw bad('That address points inside this network. Use a public address.')
  }
  u.hash = ''
  return u.toString()
}

/** The destination is not allowed (private network, too many redirects). Retrying will not help. */
export class BlockedDestination extends Error {}

export type Resolver = (host: string) => Promise<string[]>
export const defaultResolver: Resolver = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address)

export async function assertPublicDestination(url: string, resolve: Resolver, allowPrivate: boolean) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (allowPrivate) return
  const addresses = isIP(host) ? [host] : await resolve(host)
  if (!addresses.length) throw new BlockedDestination(`The host ${host} did not resolve.`)
  if (addresses.some(isPrivateAddress)) throw new BlockedDestination(`The host ${host} points inside this network, so nothing was fetched or sent.`)
}

/**
 * GET an address, following at most `maxRedirects` redirects by hand and checking every hop like the first one.
 * Returns the final response (not yet read).
 */
export async function followSafely(url: string, deps: { fetch: typeof fetch; resolve: Resolver; allowPrivate: boolean; maxRedirects?: number; timeoutMs?: number; headers?: Record<string, string> }): Promise<{ res: Response; finalUrl: string }> {
  let current = url
  for (let hop = 0; hop <= (deps.maxRedirects ?? 3); hop++) {
    const checked = checkPublicUrl(current, { allowHttp: deps.allowPrivate })
    await assertPublicDestination(checked, deps.resolve, deps.allowPrivate)
    const res = await deps.fetch(checked, { method: 'GET', redirect: 'manual', headers: deps.headers, signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000) })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new BlockedDestination(`The address answered with a redirect (${res.status}) but no new address.`)
      current = new URL(loc, checked).toString()
      continue
    }
    return { res, finalUrl: checked }
  }
  throw new BlockedDestination(`Too many redirects (more than ${deps.maxRedirects ?? 3}).`)
}

/** Read a response body, stopping with an error once it passes maxBytes (the Content-Length header is not trusted). */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new Error(`The file is too big (${Math.ceil(declared / 1048576)} MB). The limit is ${Math.floor(maxBytes / 1048576)} MB.`)
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`The file is too big. The limit is ${Math.floor(maxBytes / 1048576)} MB.`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
