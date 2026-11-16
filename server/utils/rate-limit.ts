// Simple in-memory fixed-window rate limiter (one process per install).
const buckets = new Map<string, { count: number; resetAt: number }>()

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  b.count++
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  return b.count <= limit
}
