// Brand pack: tokens, fonts, logo and the active theme. One per site. See docs/11-theming.md and docs/13-data-model.md.
import { z } from 'zod'
import { cssCautionWarnings } from './css/cautions'
import { CssRejected, cssIssueMessage, sanitizeCss } from './css/sanitize'
import { zodIssues, type FieldIssue } from './issues'
import { contrastRatio, contrastWarning } from './contrast'
import { HEADER_STYLES, type HeaderStyle } from './site-parts'
import { DEFAULT_THEME_TOKENS, logoPillColour, type ThemeTokens } from './theme-css'

const hex = z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: 'Use a hex colour, like #b5471d.' })
const fontFamily = z.string().trim().min(1).max(160).regex(/^[^;{}<>]+$/, { message: 'Use a font name or a simple font list, with no extra punctuation.' })

type StoredBrandTokens = {
  ink: string
  paper: string
  muted: string
  accent: string
  accentInk: string
  line: string
  band: string
  urgent: string
  celebrate: string
  highlight: string
  logoPill?: string
}

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
    /** Optional. White, empty, and null are omitted so the base CSS white pills stay. */
    logoPill: z.preprocess((value) => {
      if (value == null) return undefined
      if (typeof value !== 'string') return value
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }, hex.optional()),
  })
  .strict()
  .transform((tokens): StoredBrandTokens => {
    const colour = logoPillColour(tokens.logoPill)
    const next: StoredBrandTokens = {
      ink: tokens.ink,
      paper: tokens.paper,
      muted: tokens.muted,
      accent: tokens.accent,
      accentInk: tokens.accentInk,
      line: tokens.line,
      band: tokens.band,
      urgent: tokens.urgent,
      celebrate: tokens.celebrate,
      highlight: tokens.highlight,
    }
    if (colour) next.logoPill = colour
    return next
  })
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
    /** Author's site-wide CSS. Blank and missing are the same and the key is left off. */
    customCss: z.preprocess((value) => {
      if (value == null) return undefined
      if (typeof value !== 'string') return value
      return value.trim() ? value : undefined
    }, z.string().optional()),
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

/** Keep a non-empty site sheet only when the sanitiser accepts it. Blank clears the field. */
function keptSiteCss(value: unknown): { css?: string; issue?: string } {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    sanitizeCss(value, { scope: 'site', mode: 'check' })
    return { css: value }
  } catch (error) {
    if (error instanceof CssRejected) return { issue: cssIssueMessage(error) }
    throw error
  }
}

export function validateBrandDoc(raw: unknown): { ok: true; doc: BrandDoc } | { ok: false; issues: FieldIssue[] } {
  const parsed = brandDocSchema.safeParse(migrateBrandDoc(raw))
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) }
  const css = keptSiteCss(parsed.data.customCss)
  if (css.issue) return { ok: false, issues: [{ path: 'customCss', message: css.issue }] }
  const doc: BrandDoc = { ...parsed.data }
  if (css.css) doc.customCss = css.css
  else delete doc.customCss
  return { ok: true, doc }
}

type RequiredToken = Exclude<keyof BrandTokens, 'logoPill'>

const CONTRAST_PAIRS: { path: string; label: string; fg: RequiredToken; bg: RequiredToken; min: number }[] = [
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
  // Footer logo text is #1f1a17 on the pill. White uses the base rule and is not checked.
  const pill = logoPillColour(doc.tokens.logoPill)
  if (pill) {
    const message = contrastWarning('Logo text on the logo background', contrastRatio('#1f1a17', pill), 4.5)
    if (message) warnings.push({ path: 'tokens.logoPill', message })
  }
  warnings.push(...cssCautionWarnings(doc.customCss ?? '', 'customCss'))
  return { blocking: [], warnings }
}

export type { ThemeTokens }
