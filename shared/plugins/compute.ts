// Closed computed ops and the same maths the template helpers call. No expression language.
import { formatMoney, parseAmount, progressPercent } from '../amounts'
import type { ComputedField } from './manifest'

export interface MatchFill {
  hD: number
  hM: number
  yD: number
  yM: number
  percent: number
}

export type ComputedValue = string | number | MatchFill

export function readPath(root: unknown, path: string): unknown {
  let current = root
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function asAmount(value: unknown): string | number | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  return undefined
}

export function computePercent(a: unknown, b: unknown): number {
  return progressPercent(asAmount(a), asAmount(b)) ?? 0
}

/** Integer 0..max. 0 when b cannot be parsed or is 0. */
export function computeSvgScale(a: unknown, b: unknown, max: number): number {
  const left = parseAmount(asAmount(a))
  const right = parseAmount(asAmount(b))
  if (left === null || right === null || right === 0) return 0
  const raw = Math.round((left / right) * max)
  if (raw < 0) return 0
  if (raw > max) return max
  return raw
}

export function computeMoney(amount: unknown, currency: unknown): string {
  const body = typeof amount === 'number' && Number.isFinite(amount) ? String(amount) : typeof amount === 'string' ? amount : ''
  const prefix = typeof currency === 'string' ? currency : ''
  return formatMoney(prefix, body)
}

export function computeAdd(a: unknown, b: unknown): number {
  const left = parseAmount(asAmount(a)) ?? 0
  const right = parseAmount(asAmount(b)) ?? 0
  const sum = left + right
  return sum < 0 ? 0 : sum
}

export function computeSubtract(a: unknown, b: unknown): number {
  const left = parseAmount(asAmount(a)) ?? 0
  const right = parseAmount(asAmount(b)) ?? 0
  return Math.max(0, left - right)
}

export function computeMin(a: unknown, b: unknown): number {
  const left = parseAmount(asAmount(a)) ?? 0
  const right = parseAmount(asAmount(b)) ?? 0
  return Math.min(left, right)
}

/**
 * Thermometer tube from the old renderer: top and bottom are the tube ends,
 * hD is the donation fill, hM the match stacked above it, yD and yM their tops.
 * percent is the floored total, capped at 100, not progressPercent.
 */
export function computeMatchFill(raised: unknown, matched: unknown, goal: unknown, top: number, bottom: number): MatchFill {
  const tube = bottom - top
  const goalN = parseAmount(asAmount(goal))
  if (goalN === null || goalN <= 0 || tube <= 0) return { hD: 0, hM: 0, yD: bottom, yM: bottom, percent: 0 }
  const raisedN = parseAmount(asAmount(raised)) ?? 0
  const matchedN = parseAmount(asAmount(matched)) ?? 0
  const hD = Math.min(tube, Math.round((raisedN / goalN) * tube))
  const hM = Math.min(tube - hD, Math.round((matchedN / goalN) * tube))
  const yD = bottom - hD
  const yM = bottom - hD - hM
  const percent = Math.min(100, Math.floor(((raisedN + matchedN) / goalN) * 100))
  return { hD, hM, yD, yM, percent }
}

function argValue(arg: string | number, props: Record<string, unknown>, earlier: Record<string, ComputedValue>): unknown {
  if (typeof arg === 'number') return arg
  if (Object.prototype.hasOwnProperty.call(earlier, arg)) return earlier[arg]
  return readPath(props, arg)
}

function currencyOf(arg: string | number | undefined, props: Record<string, unknown>, earlier: Record<string, ComputedValue>): string {
  if (arg !== undefined) {
    const value = argValue(arg, props, earlier)
    return typeof value === 'string' ? value : ''
  }
  return typeof props.currency === 'string' ? props.currency : ''
}

/** Dependency order is the manifest order. Cycles are already rejected there. */
export function evaluateComputed(fields: readonly ComputedField[], props: Record<string, unknown>): Record<string, ComputedValue> {
  const out: Record<string, ComputedValue> = {}
  for (const field of fields) {
    const a = field.args[0]
    const b = field.args[1]
    if (field.op === 'percent' && a !== undefined && b !== undefined) out[field.name] = computePercent(argValue(a, props, out), argValue(b, props, out))
    else if (field.op === 'svg-scale' && a !== undefined && b !== undefined && typeof field.args[2] === 'number') {
      out[field.name] = computeSvgScale(argValue(a, props, out), argValue(b, props, out), field.args[2])
    } else if (field.op === 'money' && a !== undefined) out[field.name] = computeMoney(argValue(a, props, out), currencyOf(field.args[1], props, out))
    else if (field.op === 'add' && a !== undefined && b !== undefined) out[field.name] = computeAdd(argValue(a, props, out), argValue(b, props, out))
    else if (field.op === 'subtract' && a !== undefined && b !== undefined) out[field.name] = computeSubtract(argValue(a, props, out), argValue(b, props, out))
    else if (field.op === 'min' && a !== undefined && b !== undefined) out[field.name] = computeMin(argValue(a, props, out), argValue(b, props, out))
    else if (field.op === 'match-fill' && a !== undefined && b !== undefined && field.args[2] !== undefined && typeof field.args[3] === 'number' && typeof field.args[4] === 'number') {
      out[field.name] = computeMatchFill(argValue(a, props, out), argValue(b, props, out), argValue(field.args[2], props, out), field.args[3], field.args[4])
    } else out[field.name] = 0
  }
  return out
}
