// Site settings stored on the sites row. One schema so reads, writes and the GUI agree.
// See docs/04-gui.md (Settings) and ADR 0011 (named tracking integrations).
import { z } from 'zod'
import { cloneDraft } from './clone'

const id = (re: RegExp, example: string) => z.string().trim().regex(re, `Should look like ${example}.`)

export const EMBED_PROVIDER_KEYS = ['virtuous', 'youtube', 'tally', 'google_forms'] as const

export const trackingSchema = z
  .object({
    ga4: id(/^G-[A-Z0-9]{4,12}$/, 'G-ABC123XYZ').nullable().default(null),
    gtm: id(/^GTM-[A-Z0-9]{4,10}$/, 'GTM-ABC1234').nullable().default(null),
    plausible: id(/^[a-z0-9.-]{3,253}$/, 'example.org').nullable().default(null),
    cookiebot: id(/^[0-9a-f-]{36}$/, 'a Cookiebot domain group id (36 characters)').nullable().default(null),
  })
  .strict()

export const siteSettingsSchema = z
  .object({
    titlePattern: z.string().trim().max(80).default('{page} | {site}'),
    workflow: z.object({ selfApproval: z.boolean().default(false) }).strict().default({ selfApproval: false }),
    allowedEmbedProviders: z.array(z.enum(EMBED_PROVIDER_KEYS)).optional(),
    tracking: trackingSchema.default({ ga4: null, gtm: null, plausible: null, cookiebot: null }),
    /** Kill switch for every agent token at once (ADR 0018). Changed through /api/v1/agent/pause, not PATCH /settings. */
    agent: z.object({ paused: z.boolean().default(false) }).strict().default({ paused: false }),
    seo: z.object({ defaultSocialImage: z.string().max(64).nullable().default(null), allowIndexing: z.boolean().default(true), robotsTxt: z.string().max(8000).nullable().default(null) }).strict().default({ defaultSocialImage: null, allowIndexing: true, robotsTxt: null }),
    ai: z
      .object({
        enabled: z.boolean().default(false),
        /** openai, xai, anthropic or custom — all talk the OpenAI-compatible chat API. */
        provider: z.enum(['openai', 'xai', 'anthropic', 'custom']).default('xai'),
        /** Override the provider's default base URL (required for custom). */
        baseUrl: z.string().trim().url().max(300).nullable().default(null),
        model: z.string().trim().min(1).max(120).default('grok-4'),
        /** Optional cheaper model for small jobs such as alt text. */
        smallModel: z.string().trim().min(1).max(120).nullable().default(null),
        monthlyCapPence: z.number().int().min(0).max(1_000_000).default(2000),
        sessionCapPence: z.number().int().min(0).max(1_000_000).default(200),
        requestCapPence: z.number().int().min(0).max(1_000_000).default(50),
      })
      .strict()
      .default({
        enabled: false,
        provider: 'xai',
        baseUrl: null,
        model: 'grok-4',
        smallModel: null,
        monthlyCapPence: 2000,
        sessionCapPence: 200,
        requestCapPence: 50,
      }),
    mail: z
      .object({
        from: z.string().trim().toLowerCase().max(254).nullable().default(null),
        googleClientId: z.string().trim().max(200).nullable().default(null),
        /** Set only by the Google OAuth callback, not by PATCH. */
        googleAccount: z.string().trim().toLowerCase().max(254).nullable().default(null),
      })
      .strict()
      .default({ from: null, googleClientId: null, googleAccount: null }),
  })
  .strict()

export type SiteSettings = z.infer<typeof siteSettingsSchema>

/** What PATCH /settings accepts: any subset, one level of nesting merged. */
export const settingsPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    primaryDomain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]{3,253}$/, 'Just the domain, like example.org.').nullable().optional(),
    titlePattern: z.string().trim().max(80).optional(),
    workflow: z.object({ selfApproval: z.boolean() }).strict().optional(),
    allowedEmbedProviders: z.array(z.enum(EMBED_PROVIDER_KEYS)).optional(),
    tracking: trackingSchema.partial().optional(),
    seo: z.object({ defaultSocialImage: z.string().max(64).nullable(), allowIndexing: z.boolean(), robotsTxt: z.string().max(8000).nullable() }).partial().strict().optional(),
    ai: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(['openai', 'xai', 'anthropic', 'custom']),
        baseUrl: z.string().trim().url().max(300).nullable(),
        model: z.string().trim().min(1).max(120),
        smallModel: z.string().trim().min(1).max(120).nullable(),
        monthlyCapPence: z.number().int().min(0).max(1_000_000),
        sessionCapPence: z.number().int().min(0).max(1_000_000),
        requestCapPence: z.number().int().min(0).max(1_000_000),
      })
      .partial()
      .strict()
      .optional(),
    mail: z
      .object({
        from: z
          .string()
          .trim()
          .toLowerCase()
          .max(254)
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Use a full email address, like noreply@example.org.')
          .nullable(),
        googleClientId: z.string().trim().max(200).nullable(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

/** Read stored settings leniently: unknown or broken values fall back to defaults rather than failing. */
export function readSettings(raw: unknown): SiteSettings {
  const parsed = siteSettingsSchema.safeParse(raw ?? {})
  if (parsed.success) return parsed.data
  const base = siteSettingsSchema.parse({})
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      const one = siteSettingsSchema.shape[key as keyof SiteSettings]?.safeParse(value)
      if (one?.success) (base as Record<string, unknown>)[key] = one.data
    }
  }
  return base
}

export function mergeSettings(current: SiteSettings, patch: Omit<SettingsPatch, 'name' | 'primaryDomain'>): SiteSettings {
  const next: Record<string, unknown> = cloneDraft(current)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const cur = next[key]
    next[key] = value && typeof value === 'object' && !Array.isArray(value) && cur && typeof cur === 'object' ? { ...cur, ...value } : value
  }
  return siteSettingsSchema.parse(next)
}
