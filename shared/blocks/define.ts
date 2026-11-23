// Block definitions: the single source of truth for a section's props, editor fields,
// validation, AI tool schemas and image slot sizes. See docs/03-block-model.md.
import { z } from 'zod'
import { safeHref } from '../richtext'

export interface ImageSlot {
  width: number
  height: number
}

/** Short guidance shown to the page assistant and included in list_blocks. */
export interface BlockAiExample {
  /** Why this is a good use, or what is wrong with the anti-pattern. */
  note: string
  /** Realistic (or deliberately poor) sample props. Media ids may be placeholders. */
  props?: Record<string, unknown>
}

export interface BlockAiGuide {
  purpose: string
  useWhen: string
  pairsWith: string[]
  avoidWhen: string
  fields: string
  good: BlockAiExample
  bad: BlockAiExample
}

export type PropsMigration = (props: Record<string, unknown>) => Record<string, unknown>

export interface BlockDefinition<TProps extends z.ZodObject = z.ZodObject> {
  type: string
  /** Current version of this block's props. Stored blocks record the version they were written with. */
  version: number
  label: string
  category: 'Headers' | 'Text' | 'Media' | 'Calls to action' | 'Embeds' | 'Lists'
  props: TProps
  /** Image props and the size their slot needs, for the crop step. */
  imageSlots?: Record<string, ImageSlot>
  /** Prop names that hold short headings (checked for emptiness and placeholders). */
  headingProps?: string[]
  /** True only when the block needs client-side JavaScript on the public page. */
  clientJs?: boolean
  /** migrations[n] upgrades props from version n to n + 1. */
  migrations?: Record<number, PropsMigration>
  /** Valid sample props, used by tests and the starter content. */
  sample: z.input<TProps>
  /** How the assistant should use this section. */
  ai?: BlockAiGuide
}

export function defineBlock<TProps extends z.ZodObject>(def: BlockDefinition<TProps>): BlockDefinition<TProps> {
  for (let v = 1; v < def.version; v++) {
    if (!def.migrations?.[v]) throw new Error(`Block ${def.type} is at version ${def.version} but has no migration from version ${v}.`)
  }
  return def
}

// Prop helpers. Keep them small: they are only Zod with friendlier messages.

export function text(opts: { max: number; required: true }): z.ZodString
export function text(opts: { max: number; required?: false }): z.ZodOptional<z.ZodString>
export function text(opts: { max: number; required?: boolean }): z.ZodString | z.ZodOptional<z.ZodString> {
  const base = z
    .string()
    .trim()
    .max(opts.max, { message: `Keep this under ${opts.max} characters.` })
  return opts.required ? base.min(1, { message: 'This is needed.' }) : base.optional()
}

export const mediaId = z.string().regex(/^med_[0-9A-Z]{26}$/, { message: 'Pick an image from the media library.' })
export const embedId = z.string().regex(/^emb_[0-9A-Z]{26}$/, { message: 'Pick a registered form or embed.' })

export const imageRef = z
  .object({
    media: mediaId,
    alt: z.string().trim().max(250, { message: 'Keep alt text under 250 characters.' }).optional(),
    decorative: z.boolean().optional(),
  })
  .strict()

export type ImageRef = z.infer<typeof imageRef>

export const linkRef = z
  .object({
    label: z.string().trim().min(1, { message: 'Add the button text.' }).max(40, { message: 'Keep button text under 40 characters.' }),
    href: safeHref,
  })
  .strict()

export const tone = z.enum(['primary', 'neutral', 'accent'])

/** Optional section fill. Unset keeps today's background. Not used on Hero, VideoHero, CallToAction or MatchBanner. */
export const sectionBackground = z.enum(['card', 'warm']).optional()
