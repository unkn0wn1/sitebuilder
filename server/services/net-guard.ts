// Guards for any request the server makes to an address someone typed (agent alerts, photo imports).
// HTTPS only, no credentials in the address, no private, loopback or link-local destinations. The resolved addresses
// are checked again just before connecting, so a name that later points inside the network is refused. Callers must
// not follow redirects without checking each hop again (see followSafely).
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { AppError } from './errors'

/** The 16 bytes of an IPv6 address (any textual form, including a trailing dotted IPv4), or null. */
function ipv6Bytes(ip: string): number[] | null {
  let v = ip.toLowerCase().split('%')[0]!
  const dotted = v.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const p = dotted[1]!.split('.').map(Number)
    v = v.slice(0, -dotted[1]!.length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`
  }
  const [head, tail] = v.includes('::') ? v.split('::') as [string, string] : [v, null]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  if (groups.length !== 8) return null
  return groups.flatMap((g) => {
    const n = parseInt(g || '0', 16)
    return [(n >> 8) & 255, n & 255]
  })
}

const v4 = (b: number[]) => b.join('.')

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (kind === 6) {
    const b = ipv6Bytes(ip)
    if (!b) return true
    const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0)
    // IPv4 hidden inside IPv6: mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1), compatible (::a.b.c.d),
    // NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::). Judge the IPv4 address inside.
    if (zero(0, 10) && b[10] === 255 && b[11] === 255) return isPrivateAddress(v4(b.slice(12)))
    if (zero(0, 12)) return zero(12, 15) ? true : isPrivateAddress(v4(b.slice(12)))
    if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return isPrivateAddress(v4(b.slice(12)))
    if (b[0] === 0x20 && b[1] === 0x02) return isPrivateAddress(v4(b.slice(2, 6)))
    const first = (b[0]! << 8) | b[1]!
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return true // link-local, old site-local
    if (b[0] === 0xff) return true // multicast
    if (first === 0x2001 && b[2] === 0x0d && b[3] === 0xb8) return true // documentation
    if (first === 0x2001 && b[2] === 0 && b[3] === 0) return true // Teredo (hides an IPv4)
    return false
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
