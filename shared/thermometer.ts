// Pure match-thermometer figures, tube geometry and countdown split.
// The renderer and the tests share this so a badge cannot cover a tick label.

export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const ENDED_TEXT = 'This match has ended. Gifts still help.'

const TUBE_Y0 = 330
const TUBE_SPAN = 310
const BADGE_X = 88
const BADGE_W = 52
const BADGE_H = 28
const LABEL_X = 100
const CHAR_W = 8

export interface ThermoInput {
  goal: number
  raised: number
  matched: number
  donors: number
  matchCap: number
  /** Omitted means min(matched, matchCap). */
  matchUsed?: number | null
}

export interface ThermoFigures {
  goal: number
  raised: number
  matched: number
  donors: number
  matchCap: number
  matchUsed: number
  total: number
  /** 0 to 100. The tube stops at 100. The total can be higher. */
  percent: number
  /** Share of the goal drawn as donations, capped at 1. */
  raisedShare: number
  /** Share of the goal drawn in total, capped at 1. */
  totalShare: number
}

export interface TubeTick {
  fraction: number
  label: string
  y: number
  showLabel: boolean
}

export interface TubeLayout {
  yTotal: number
  yRaised: number
  donationsHeight: number
  matchHeight: number
  badgeX: number
  badgeY: number
  badgeW: number
  badgeH: number
  badgeTextX: number
  badgeTextY: number
  ticks: TubeTick[]
}

export interface BarLayout {
  badgeX: number
  badgeY: number
  badgeW: number
  badgeH: number
  badgeTextX: number
  badgeTextY: number
  trackX: number
  trackY: number
  trackW: number
  trackH: number
  innerX: number
  innerY: number
  innerW: number
  innerH: number
  raisedW: number
  matchW: number
}

export interface CountdownParts {
  ended: boolean
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function r1(n: number): number {
  return Math.round(n * 10) / 10
}

function finite(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

export function groupNumber(amount: number): string {
  const neg = amount < 0
  const rounded = Math.round(Math.abs(amount) * 100) / 100
  const [whole, frac] = rounded.toFixed(2).split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const tail = frac === '00' ? '' : frac!.endsWith('0') ? `.${frac![0]}` : `.${frac}`
  return `${neg ? '-' : ''}${grouped}${tail}`
}

export function money(currency: string, amount: number): string {
  return `${currency.trim()}${groupNumber(amount)}`
}

/** Scale ticks: $15K when the amount is a whole number of thousands, otherwise the full figure. */
export function compactTick(currency: string, amount: number): string {
  const abs = Math.abs(Math.round(amount))
  const prefix = currency.trim()
  if (abs >= 1_000_000 && abs % 1_000_000 === 0) return `${prefix}${abs / 1_000_000}M`
  if (abs >= 1000 && abs % 1000 === 0) return `${prefix}${abs / 1000}K`
  return money(currency, abs)
}

export function gaugeLabel(currency: string, total: number, goal: number, percent: number): string {
  return `${money(currency, total)} of ${money(currency, goal)}, ${percent} percent`
}

export function chipText(currency: string, matchCap: number): string {
  return `Match active: every gift matched up to ${money(currency, matchCap)}`
}

export function goalTicks(currency: string, goal: number): { fraction: number; label: string }[] {
  return [0.25, 0.5, 0.75, 1].map((fraction) => ({
    fraction,
    label: compactTick(currency, goal * fraction),
  }))
}

export function thermoFigures(input: ThermoInput): ThermoFigures {
  const goal = Math.max(0, finite(input.goal))
  const raised = Math.max(0, finite(input.raised))
  const matched = Math.max(0, finite(input.matched))
  const donors = Math.max(0, finite(input.donors))
  const matchCap = Math.max(0, finite(input.matchCap))
  const total = raised + matched
  const percent = goal > 0 ? clamp(Math.round((total / goal) * 100), 0, 100) : 0
  const raisedShare = goal > 0 ? clamp(raised / goal, 0, 1) : 0
  const totalShare = goal > 0 ? clamp(total / goal, 0, 1) : 0
  const derived = Math.min(matched, matchCap)
  const explicit = finite(input.matchUsed)
  const matchUsed = matchCap <= 0 ? 0 : input.matchUsed == null ? derived : clamp(explicit, 0, matchCap)
  return { goal, raised, matched, donors, matchCap, matchUsed, total, percent, raisedShare, totalShare }
}

/** 0% sits at y=330 and 100% at y=20, matching the tube viewBox. */
export function yAt(fraction: number): number {
  return r1(TUBE_Y0 - TUBE_SPAN * clamp(fraction, 0, 1))
}

function boxesOverlap(
  a: { t: number; b: number; l: number; r: number },
  b: { t: number; b: number; l: number; r: number },
): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
}

/** Drop any tick label whose box meets the percent badge. The tick line stays. */
export function tubeLayout(
  percent: number,
  raisedShare: number,
  totalShare: number,
  ticks: { fraction: number; label: string }[],
): TubeLayout {
  const p = clamp(percent, 0, 100) / 100
  const y = yAt(p)
  let badgeY = r1(y - 14)
  if (badgeY < 0) badgeY = 0
  const badge = { t: badgeY, b: r1(badgeY + BADGE_H), l: BADGE_X, r: BADGE_X + BADGE_W }
  const yRaised = yAt(raisedShare)
  const yTotal = yAt(totalShare)
  return {
    yTotal,
    yRaised,
    donationsHeight: raisedShare > 0 ? r1(360 - yRaised) : 0,
    matchHeight: totalShare > raisedShare ? r1(yRaised - yTotal) : 0,
    badgeX: BADGE_X,
    badgeY,
    badgeW: BADGE_W,
    badgeH: BADGE_H,
    badgeTextX: BADGE_X + BADGE_W / 2,
    badgeTextY: r1(badgeY + 19),
    ticks: ticks.map((tick) => {
      const ty = yAt(tick.fraction)
      const baseline = ty + 5
      const label = {
        t: baseline - 11,
        b: baseline + 4,
        l: LABEL_X,
        r: LABEL_X + CHAR_W * tick.label.length,
      }
      return { ...tick, y: ty, showLabel: !boxesOverlap(label, badge) }
    }),
  }
}

/** Phone bar. The badge sits above the track, clamped so it stays inside the viewBox. */
export function barLayout(percent: number, raisedShare: number, totalShare: number): BarLayout {
  const p = clamp(percent, 0, 100) / 100
  const innerX = 6
  const innerW = 308
  const raisedW = r1(innerW * clamp(raisedShare, 0, 1))
  const totalW = r1(innerW * clamp(totalShare, 0, 1))
  const matchW = r1(Math.max(0, totalW - raisedW))
  const badgeW = 52
  const badgeH = 26
  let badgeX = r1(innerX + innerW * p - badgeW / 2)
  if (badgeX < 0) badgeX = 0
  if (badgeX > 320 - badgeW) badgeX = r1(320 - badgeW)
  return {
    badgeX,
    badgeY: 2,
    badgeW,
    badgeH,
    badgeTextX: r1(badgeX + badgeW / 2),
    badgeTextY: 20,
    trackX: 2,
    trackY: 26,
    trackW: 316,
    trackH: 46,
    innerX,
    innerY: 30,
    innerW,
    innerH: 38,
    raisedW,
    matchW,
  }
}

export function parseInstant(value: string): number | null {
  if (!INSTANT_PATTERN.test(value)) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function countdownParts(now: Date, endsAt: string): CountdownParts {
  const end = parseInstant(endsAt)
  const zero = { ended: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  if (end === null || now.getTime() >= end) return zero
  let rest = Math.floor((end - now.getTime()) / 1000)
  const days = Math.floor(rest / 86400)
  rest -= days * 86400
  const hours = Math.floor(rest / 3600)
  rest -= hours * 3600
  const minutes = Math.floor(rest / 60)
  const seconds = rest - minutes * 60
  return { ended: false, days, hours, minutes, seconds }
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}
