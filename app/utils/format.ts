/** Relative time in plain words, e.g. "5m ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 14) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export function canvasScale(available: number, width: number): number {
  if (available <= 0 || width <= 0) return 1
  return Math.min(1, available / width)
}
