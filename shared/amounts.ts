// Parse editor-entered gift amounts such as "₹1,20,000" or "250,000" into a number for progress bars.

export function parseAmount(value: string | number | undefined | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function progressPercent(raised: string | number | undefined, goal: string | number | undefined): number | null {
  const r = parseAmount(raised)
  const g = parseAmount(goal)
  if (r === null || g === null || g <= 0) return null
  return Math.max(0, Math.min(100, Math.round((r / g) * 100)))
}

export function formatMoney(currency: string | undefined, amount: string): string {
  const prefix = currency?.trim() ?? ''
  const body = amount.trim()
  if (!body) return prefix
  if (!prefix) return body
  if (body.startsWith(prefix)) return body
  return `${prefix}${body}`
}

/** Inclusive end of the given YYYY-MM-DD in UTC. */
export function endOfUtcDay(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const end = new Date(`${isoDate}T23:59:59.000Z`)
  return Number.isNaN(end.getTime()) ? null : end
}

export function hasEnded(isoDate: string | undefined, now = new Date()): boolean {
  if (!isoDate) return false
  const end = endOfUtcDay(isoDate)
  return !!end && now.getTime() > end.getTime()
}
