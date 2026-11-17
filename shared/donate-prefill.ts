// Turn an impact-tier click into a Virtuous Raise pre-fill.
// Documented URL params and window.RaiseDonorsForms.settings.giftInfo:
// https://apidocs.raisedonors.com/ (Raise JS) and
// https://support.raisedonors.com/hc/en-us/articles/26963126285453-How-Do-I-Customize-URLs-to-Track-and-Set-Giving-Details
// URL parameters take precedence over the JS object. Do not invent amounts.
import { looksLikePlaceholder } from './checks'
import { parseAmount } from './amounts'

/** Values the editor can store on a tier. */
export const TIER_FREQUENCIES = ['once', 'monthly', 'quarterly', 'annually'] as const
export type TierFrequency = (typeof TIER_FREQUENCIES)[number]

/** Values accepted by Virtuous Raise URL params / JS giftInfo, including aliases. */
export const VIRTUOUS_FREQUENCIES = [
  'once',
  'one-time',
  'monthly',
  'quarterly',
  'annually',
  'yearly',
  'weekly',
  'everyotherweek',
  'biannually',
] as const

const FREQUENCY_ALIASES: Record<string, string> = {
  once: 'once',
  'one-time': 'once',
  onetime: 'once',
  'one time': 'once',
  single: 'once',
  monthly: 'monthly',
  month: 'monthly',
  quarterly: 'quarterly',
  quarter: 'quarterly',
  annually: 'annually',
  annual: 'annually',
  yearly: 'annually',
  year: 'annually',
  weekly: 'weekly',
  week: 'weekly',
  everyotherweek: 'everyotherweek',
  'every other week': 'everyotherweek',
  fortnightly: 'everyotherweek',
  biannually: 'biannually',
  'bi-annually': 'biannually',
}

export interface DonatePrefill {
  amount?: string
  frequency?: string
  label?: string
}

export function donateAmountParam(amount: string | number | undefined | null): string | undefined {
  if (typeof amount === 'string' && looksLikePlaceholder(amount)) return undefined
  const n = parseAmount(amount)
  if (n === null || n <= 0) return undefined
  return Number.isInteger(n) ? String(n) : String(n)
}

export function normaliseFrequency(value: string | undefined | null): string | undefined {
  if (!value) return undefined
  const key = value.trim().toLowerCase()
  if (!key || looksLikePlaceholder(key)) return undefined
  return FREQUENCY_ALIASES[key]
}

export function virtuousPrefill(input: { amount?: string | number | null; frequency?: string | null; label?: string | null }): DonatePrefill {
  const amount = donateAmountParam(input.amount)
  const frequency = normaliseFrequency(input.frequency ?? undefined)
  const label = input.label?.trim() || (typeof input.amount === 'string' ? input.amount.trim() : amount ? amount : undefined)
  const out: DonatePrefill = {}
  if (amount) out.amount = amount
  if (frequency) out.frequency = frequency
  if (label && (amount || frequency)) out.label = label
  return out
}

export function prefillSearchParams(current: string, prefill: DonatePrefill): string {
  const params = new URLSearchParams(current.startsWith('?') ? current.slice(1) : current)
  if (prefill.amount) params.set('amount', prefill.amount)
  else params.delete('amount')
  if (prefill.frequency) params.set('frequency', prefill.frequency)
  else params.delete('frequency')
  const q = params.toString()
  return q ? `?${q}` : ''
}

export function prefillHint(prefill: DonatePrefill): string | undefined {
  if (!prefill.amount && !prefill.frequency) return undefined
  const amount = prefill.label || (prefill.amount ? prefill.amount : '')
  if (prefill.frequency && amount) {
    const freq = prefill.frequency === 'once' ? 'one-time' : prefill.frequency
    return `Selected: ${amount}, ${freq}. You can change this on the form.`
  }
  if (amount) return `Selected: ${amount}. You can change this on the form.`
  return `Selected: ${prefill.frequency}. You can change this on the form.`
}

/** Apply documented Virtuous Raise JS defaults. Safe to call before or after the embed script loads. */
export function applyRaiseDonorsGiftInfo(target: Record<string, unknown>, prefill: DonatePrefill): Record<string, unknown> {
  const existing = (target.RaiseDonorsForms as Record<string, unknown> | undefined) ?? {}
  const settings = (existing.settings as Record<string, unknown> | undefined) ?? {}
  const giftInfo = { ...((settings.giftInfo as Record<string, unknown> | undefined) ?? {}) }
  if (prefill.amount) giftInfo.amount = Number(prefill.amount) || prefill.amount
  if (prefill.frequency) giftInfo.frequency = prefill.frequency
  const next = { ...existing, settings: { ...settings, giftInfo } }
  target.RaiseDonorsForms = next
  return next
}

export function readPrefillFromElement(el: { getAttribute: (name: string) => string | null }): DonatePrefill {
  return virtuousPrefill({
    amount: el.getAttribute('data-donate-amount'),
    frequency: el.getAttribute('data-donate-frequency'),
    label: el.getAttribute('data-donate-label'),
  })
}
