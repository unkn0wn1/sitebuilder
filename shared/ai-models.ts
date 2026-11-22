// One list of model ids for every xAI-backed feature. Settings, the picker and pricing all read from here.

export const DEFAULT_XAI_MODEL = 'grok-4.7'

/** The previous xAI default. A saved copy of this, on provider xai, is read as DEFAULT_XAI_MODEL. */
export const LEGACY_DEFAULT_MODELS = ['grok-4'] as const

export const PROVIDER_DEFAULT_MODELS = {
  xai: DEFAULT_XAI_MODEL,
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
  custom: '',
} as const

export type AiProvider = keyof typeof PROVIDER_DEFAULT_MODELS

/** Used when the site has no xAI key, or the live list cannot be fetched. */
export const CURATED_XAI_MODELS = [
  'grok-4.7',
  'grok-4.6',
  'grok-4.5',
  'grok-4.3',
  'grok-4.20-0309-reasoning',
  'grok-4.20-0309-non-reasoning',
  'grok-build-0.1',
] as const

const LEGACY = new Set<string>(LEGACY_DEFAULT_MODELS)
const CURATED = new Set<string>(CURATED_XAI_MODELS)

/** Image, video, voice and embedding ids are not chat models. Vision chat ids (no "image" in the name) stay. */
const NON_CHAT = /image|video|voice|audio|embed|tts|transcri|imagine/i

export function isLegacyDefaultModel(model: string): boolean {
  return LEGACY.has(model)
}

export function isChatModelId(id: string): boolean {
  return !NON_CHAT.test(id)
}

/**
 * Saved non-legacy id wins. A legacy default, or a missing id, on xAI becomes the new default.
 * Any other provider keeps a non-empty saved id, otherwise that provider's default.
 */
export function resolveAiModel(provider: AiProvider, saved: string | null | undefined): string {
  const model = (saved ?? '').trim()
  if (provider === 'xai') {
    if (!model || isLegacyDefaultModel(model)) return DEFAULT_XAI_MODEL
    return model
  }
  if (model) return model
  return PROVIDER_DEFAULT_MODELS[provider]
}

/** Chat ids only. Curated ids keep their catalogue order, then the rest A to Z. The saved id is always last if it was missing. */
export function selectChatModels(ids: readonly string[], current?: string | null): string[] {
  const chat = [...new Set(ids.map((id) => id.trim()).filter((id) => id && isChatModelId(id)))]
  const curated = CURATED_XAI_MODELS.filter((id) => chat.includes(id))
  const rest = chat.filter((id) => !CURATED.has(id)).sort((a, b) => a.localeCompare(b))
  const out = [...curated, ...rest]
  const saved = current?.trim()
  if (saved && !out.includes(saved)) out.push(saved)
  return out
}

export function normaliseAiSettings<T extends { provider: AiProvider; model: string }>(ai: T): T {
  if (ai.provider === 'xai' && isLegacyDefaultModel(ai.model)) return { ...ai, model: DEFAULT_XAI_MODEL }
  return ai
}
