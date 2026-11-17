// Cost estimates for caps, not invoices. Amounts are in pence per million tokens.
// costMicros on a session is millionths of a pound (1 pence = 10_000 micros).
// See docs/12-ai-harness.md (limits) and docs/07-ai-agent.md#model-and-cost.

export const PENCE_TO_MICROS = 10_000

/** Conservative defaults used when a model is not in the book. */
export const DEFAULT_PRICE = { inPencePerMillion: 100, outPencePerMillion: 400 }

const BOOK: Record<string, { inPencePerMillion: number; outPencePerMillion: number }> = {
  'grok-4': { inPencePerMillion: 80, outPencePerMillion: 400 },
  'grok-3': { inPencePerMillion: 80, outPencePerMillion: 400 },
  'grok-2': { inPencePerMillion: 40, outPencePerMillion: 200 },
  'gpt-4o': { inPencePerMillion: 200, outPencePerMillion: 800 },
  'gpt-4.1': { inPencePerMillion: 160, outPencePerMillion: 640 },
  'gpt-4o-mini': { inPencePerMillion: 12, outPencePerMillion: 48 },
  'claude-sonnet-4-5': { inPencePerMillion: 240, outPencePerMillion: 1200 },
  'claude-3-5-sonnet': { inPencePerMillion: 240, outPencePerMillion: 1200 },
}

export function priceFor(model: string): { inPencePerMillion: number; outPencePerMillion: number } {
  return BOOK[model] ?? DEFAULT_PRICE
}

/** Convert a model's token usage into millionths of a pound, rounding up. */
export function costMicrosFor(model: string, tokensIn: number, tokensOut: number): number {
  if (tokensIn <= 0 && tokensOut <= 0) return 0
  const price = priceFor(model)
  const penceTimes100 = tokensIn * price.inPencePerMillion + tokensOut * price.outPencePerMillion
  return Math.max(1, Math.ceil(penceTimes100 / 100))
}

export function penceToMicros(pence: number): number {
  return pence * PENCE_TO_MICROS
}

export function microsToPence(micros: number): number {
  return micros / PENCE_TO_MICROS
}
