// Edit operations. The GUI and the AI change drafts only through these.
// Each applied op has an inverse (for per-change undo) and a list of keys it touched (for conflicts).
// See docs/13-data-model.md#concurrent-edits-people-and-the-ai.
import { z } from 'zod'
import { blockIdSchema, pageTitleSchema, seoSchema, type PageDoc, type PageSeo } from './page'
import type { BlockRegistry, StoredBlock } from './blocks/registry'
import { cloneDraft } from './clone'

export const slugSchema = z
  .string()
  .max(80, { message: 'Keep the address under 80 characters.' })
  .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Use lower-case letters, numbers and single dashes.' })

const blockInput = z
  .object({
    // Optional id chosen by the caller (the builder picks one so it can edit the new section before the save
    // comes back). Left out, the server picks one.
    id: blockIdSchema.optional(),
    type: z.string().min(1).max(60),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

const addBlockOp = z
  .object({
    op: z.literal('add_block'),
    index: z.number().int().min(0).optional(),
    afterBlockId: blockIdSchema.optional(),
    block: blockInput,
  })
  .strict()

const updatePropsOp = z
  .object({
    op: z.literal('update_props'),
    blockId: blockIdSchema,
    props: z.record(z.string(), z.unknown()).default({}),
    unset: z.array(z.string()).optional(),
  })
  .strict()

const moveBlockOp = z.object({ op: z.literal('move_block'), blockId: blockIdSchema, toIndex: z.number().int().min(0) }).strict()
const removeBlockOp = z.object({ op: z.literal('remove_block'), blockId: blockIdSchema }).strict()

const setMetaOp = z
  .object({
    op: z.literal('set_meta'),
    title: pageTitleSchema.optional(),
    slug: slugSchema.optional(),
    parentId: z.string().nullable().optional(),
  })
  .strict()

const setSeoOp = z
  .object({
    op: z.literal('set_seo'),
    title: seoSchema.shape.title.unwrap().unwrap().nullable().optional(),
    description: seoSchema.shape.description.unwrap().unwrap().nullable().optional(),
    image: seoSchema.shape.image.unwrap().unwrap().nullable().optional(),
    canonical: seoSchema.shape.canonical.unwrap().unwrap().nullable().optional(),
    noindex: z.boolean().optional(),
  })
  .strict()

/** Operations accepted from clients (GUI and AI). */
export const opSchema = z.discriminatedUnion('op', [addBlockOp, updatePropsOp, moveBlockOp, removeBlockOp, setMetaOp, setSeoOp])
export const opsRequestSchema = z.object({ baseRevision: z.number().int().min(0), ops: z.array(opSchema).min(1).max(50) }).strict()

export type Op = z.infer<typeof opSchema>

/** Internal ops can carry a full stored block (used by undo of a removal). */
export type InternalOp = Op | { op: 'restore_block'; index: number; block: StoredBlock }

export interface PageMeta {
  slug: string
  parentId: string | null
}

export interface DraftState {
  doc: PageDoc
  meta: PageMeta
}

export interface AppliedOp {
  op: InternalOp
  inverse: InternalOp
  touches: string[]
}

export class OpError extends Error {
  constructor(
    message: string,
    public path: string,
    public kind: 'missing_block' | 'invalid' = 'invalid',
  ) {
    super(message)
  }
}

export interface ApplyContext {
  registry: BlockRegistry
  newBlockId: () => string
}

function indexOf(doc: PageDoc, blockId: string, path: string): number {
  const i = doc.blocks.findIndex((b) => b.id === blockId)
  if (i < 0) throw new OpError('That section no longer exists. It may have been removed by someone else.', path, 'missing_block')
  return i
}

function clampIndex(i: number, length: number) {
  return Math.max(0, Math.min(i, length))
}

/**
 * Apply ops to a draft. Pure: returns a new state and the applied ops with inverses and touched keys.
 * Does not validate props against block schemas; the caller validates the whole document afterwards.
 */
export function applyOps(state: DraftState, ops: InternalOp[], ctx: ApplyContext): { state: DraftState; applied: AppliedOp[] } {
  let doc: PageDoc = cloneDraft(state.doc)
  let meta: PageMeta = { ...state.meta }
  const applied: AppliedOp[] = []

  ops.forEach((op, n) => {
    const path = `ops.${n}`
    switch (op.op) {
      case 'add_block': {
        const def = ctx.registry.get(op.block.type)
        if (!def) throw new OpError(`"${op.block.type}" is not a section type.`, `${path}.block.type`)
        let index = op.index ?? doc.blocks.length
        if (op.afterBlockId) index = indexOf(doc, op.afterBlockId, `${path}.afterBlockId`) + 1
        index = clampIndex(index, doc.blocks.length)
        const id = op.block.id ?? ctx.newBlockId()
        if (doc.blocks.some((b) => b.id === id)) throw new OpError('That section is already on the page.', `${path}.block.id`)
        const block: StoredBlock = { id, type: op.block.type, v: def.version, props: op.block.props }
        doc.blocks.splice(index, 0, block)
        const normalised: InternalOp = { op: 'restore_block', index, block: cloneDraft(block) }
        applied.push({ op: normalised, inverse: { op: 'remove_block', blockId: block.id }, touches: [`block:${block.id}`] })
        break
      }
      case 'restore_block': {
        if (doc.blocks.some((b) => b.id === op.block.id)) throw new OpError('That section is already on the page.', path)
        const index = clampIndex(op.index, doc.blocks.length)
        doc.blocks.splice(index, 0, cloneDraft(op.block))
        applied.push({ op, inverse: { op: 'remove_block', blockId: op.block.id }, touches: [`block:${op.block.id}`] })
        break
      }
      case 'update_props': {
        const i = indexOf(doc, op.blockId, `${path}.blockId`)
        const block = doc.blocks[i]!
        const before: Record<string, unknown> = {}
        const unsetBack: string[] = []
        const keys = [...Object.keys(op.props), ...(op.unset ?? [])]
        for (const key of keys) {
          if (key in block.props) before[key] = cloneDraft(block.props[key])
          else unsetBack.push(key)
        }
        const props = { ...block.props, ...cloneDraft(op.props) }
        for (const key of op.unset ?? []) delete props[key]
        doc.blocks[i] = { ...block, props }
        applied.push({
          op,
          inverse: { op: 'update_props', blockId: op.blockId, props: before, ...(unsetBack.length ? { unset: unsetBack } : {}) },
          touches: keys.map((k) => `block:${op.blockId}.${k}`),
        })
        break
      }
      case 'move_block': {
        const from = indexOf(doc, op.blockId, `${path}.blockId`)
        const [block] = doc.blocks.splice(from, 1)
        const to = clampIndex(op.toIndex, doc.blocks.length)
        doc.blocks.splice(to, 0, block!)
        applied.push({ op: { ...op, toIndex: to }, inverse: { op: 'move_block', blockId: op.blockId, toIndex: from }, touches: [`order:${op.blockId}`] })
        break
      }
      case 'remove_block': {
        const i = indexOf(doc, op.blockId, `${path}.blockId`)
        const [block] = doc.blocks.splice(i, 1)
        applied.push({ op, inverse: { op: 'restore_block', index: i, block: block! }, touches: [`block:${op.blockId}.*`] })
        break
      }
      case 'set_meta': {
        const inverse: { op: 'set_meta'; title?: string; slug?: string; parentId?: string | null } = { op: 'set_meta' }
        const touches: string[] = []
        if (op.title !== undefined) {
          inverse.title = doc.title
          doc = { ...doc, title: op.title }
          touches.push('meta.title')
        }
        if (op.slug !== undefined) {
          inverse.slug = meta.slug
          meta = { ...meta, slug: op.slug }
          touches.push('meta.slug')
        }
        if (op.parentId !== undefined) {
          inverse.parentId = meta.parentId
          meta = { ...meta, parentId: op.parentId }
          touches.push('meta.parentId')
        }
        applied.push({ op, inverse, touches })
        break
      }
      case 'set_seo': {
        const fields = ['title', 'description', 'image', 'canonical', 'noindex'] as const
        const inverse: Record<string, unknown> = { op: 'set_seo' }
        const seo: PageSeo = { ...doc.seo }
        const touches: string[] = []
        for (const f of fields) {
          if (op[f] === undefined) continue
          inverse[f] = seo[f]
          ;(seo as Record<string, unknown>)[f] = op[f]
          touches.push(`seo.${f}`)
        }
        doc = { ...doc, seo }
        applied.push({ op, inverse: inverse as InternalOp, touches })
        break
      }
    }
  })

  return { state: { doc, meta }, applied }
}

/** True if two sets of touched keys overlap. Moves never conflict; removing a block conflicts with any change to it. */
export function touchesConflict(a: string[], b: string[]): string[] {
  const conflicts = new Set<string>()
  const relevant = (k: string) => !k.startsWith('order:')
  const blockOf = (k: string) => (k.startsWith('block:') ? k.slice(6).split('.')[0] : null)
  for (const x of a.filter(relevant)) {
    for (const y of b.filter(relevant)) {
      if (x === y) conflicts.add(x)
      else if ((x.endsWith('.*') || y.endsWith('.*')) && blockOf(x) !== null && blockOf(x) === blockOf(y)) conflicts.add(x.endsWith('.*') ? x : y)
    }
  }
  return [...conflicts]
}
