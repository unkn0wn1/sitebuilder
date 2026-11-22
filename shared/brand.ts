// Brand pack: tokens, fonts, logo and the active theme. One per site. See docs/11-theming.md and docs/13-data-model.md.
import { z } from 'zod'
import { zodIssues, type FieldIssue } from './issues'
import { contrastRatio, contrastWarning } from './contrast'
import { HEADER_STYLES, type HeaderStyle } from './site-parts'
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from './theme-css'

const hex = z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'Use a hex colour, like #b5471d.' })
const fontFamily = z.string().trim().min(1).max(160).regex(/^[^;{}<>]+$/, { message: 'Use a font name or a simple font list, with no extra punctuation.' })

export const brandTokensSchema = z
  .object({
    ink: hex.default(DEFAULT_THEME_TOKENS.ink),
    paper: hex.default(DEFAULT_THEME_TOKENS.paper),
    muted: hex.default(DEFAULT_THEME_TOKENS.muted),
    accent: hex.default(DEFAULT_THEME_TOKENS.accent),
    accentInk: hex.default(DEFAULT_THEME_TOKENS.accentInk),
    line: hex.default(DEFAULT_THEME_TOKENS.line),
    band: hex.default(DEFAULT_THEME_TOKENS.band),
    urgent: hex.default(DEFAULT_THEME_TOKENS.urgent),
    celebrate: hex.default(DEFAULT_THEME_TOKENS.celebrate),
    highlight: hex.default(DEFAULT_THEME_TOKENS.highlight),
  })
  .strict()
export type BrandTokens = z.infer<typeof brandTokensSchema>

/** Menu look lives on the brand pack so it can change without editing the menu tree. */
export type MenuStyle = HeaderStyle

export const brandDocSchema = z
  .object({
    schemaVersion: z.literal(1),
    tokens: brandTokensSchema.default(DEFAULT_THEME_TOKENS),
    fonts: z
      .object({
        body: fontFamily.default('system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'),
        heading: fontFamily.nullable().default(null),
      })
      .strict()
      .default({ body: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', heading: null }),
    logoMediaId: z.string().min(1).max(64).nullable().default(null),
    logoDarkMediaId: z.string().min(1).max(64).nullable().default(null),
    theme: z.string().trim().min(1).max(40).default('default'),
    menuStyle: z.enum(HEADER_STYLES).default('simple'),
  })
  .strict()

export type BrandDoc = z.infer<typeof brandDocSchema>
export const CURRENT_BRAND_SCHEMA_VERSION = 1

export function defaultBrandDoc(): BrandDoc {
  return brandDocSchema.parse({ schemaVersion: 1 })
}

export function migrateBrandDoc(raw: unknown): unknown {
  return raw ?? defaultBrandDoc()
}

export function validateBrandDoc(raw: unknown): { ok: true; doc: BrandDoc } | { ok: false; issues: FieldIssue[] } {
  const parsed = brandDocSchema.safeParse(migrateBrandDoc(raw))
  return parsed.success ? { ok: true, doc: parsed.data } : { ok: false, issues: zodIssues(parsed.error) }
}

const CONTRAST_PAIRS: { path: string; label: string; fg: keyof BrandTokens; bg: keyof BrandTokens; min: number }[] = [
  { path: 'tokens.ink', label: 'Body text on the page background', fg: 'ink', bg: 'paper', min: 4.5 },
  { path: 'tokens.muted', label: 'Muted text on the page background', fg: 'muted', bg: 'paper', min: 4.5 },
  { path: 'tokens.accentInk', label: 'Button text on the accent colour', fg: 'accentInk', bg: 'accent', min: 4.5 },
  { path: 'tokens.accent', label: 'Links on the page background', fg: 'accent', bg: 'paper', min: 3 },
]

/** Contrast warnings only — a failing pair should be visible, but it does not block saving a draft. */
export function brandContrastChecks(doc: BrandDoc): { blocking: FieldIssue[]; warnings: FieldIssue[] } {
  const warnings: FieldIssue[] = []
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(doc.tokens[pair.fg], doc.tokens[pair.bg])
    const message = contrastWarning(pair.label, ratio, pair.min)
    if (message) warnings.push({ path: pair.path, message })
  }
  return { blocking: [], warnings }
}

export type { ThemeTokens }
