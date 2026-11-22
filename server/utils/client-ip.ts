// The visitor address for rate limits and agent IP allow-lists.
// The shipped nginx overwrites X-Forwarded-For with $remote_addr after Cloudflare real-ip,
// so the last entry is the one our proxy wrote. The first entry is client-controlled when a proxy appends.
// Do not read CF-Connecting-IP. h3's xForwardedFor option is the first hop; do not use it.
import { getRequestHeader, getRequestIP, type H3Event } from 'h3'

export function clientIp(event: H3Event): string | null {
  const header = getRequestHeader(event, 'x-forwarded-for')
  if (header) {
    const last = header
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1)
    if (last) return last
  }
  return getRequestIP(event) ?? null
}
