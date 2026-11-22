// The block registry: looks up definitions, migrates stored blocks forward and validates them.
// Site-specific blocks from the site/ layer (ADR 0006) register here too.
import { z } from 'zod'
import { zodIssues, type FieldIssue } from '../issues'
import type { BlockDefinition } from './define'
import { STARTER_BLOCKS } from './library'
import { cloneDraft } from '../clone'

export interface StoredBlock {
  id: string
  type: string
  /** Version of the block type this block was written with. */
  v: number
  props: Record<string, unknown>
  /** Author's custom CSS for this section. Omitted when empty. Scoped at render. */
  css?: string
}

export class BlockMigrationError extends Error {}

export interface BlockRegistry {
  get(type: string): BlockDefinition | undefined
  has(type: string): boolean
  list(): BlockDefinition[]
  /** Upgrade a stored block to the current version of its type. Pure. */
  migrate(block: StoredBlock): StoredBlock
  /** Check props against the current schema. The block must already be migrated. */
  validate(block: StoredBlock, pathPrefix?: string): { ok: true; props: Record<string, unknown> } | { ok: false; issues: FieldIssue[] }
  /** JSON Schema of a block's props, for AI tool definitions. */
  jsonSchema(type: string): unknown
}

export function createRegistry(defs: BlockDefinition[]): BlockRegistry {
  const byType = new Map<string, BlockDefinition>()
  for (const def of defs) {
    if (byType.has(def.type)) throw new Error(`Block type ${def.type} is registered twice.`)
    byType.set(def.type, def)
  }

  return {
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    list: () => [...byType.values()],

    migrate(block) {
      const def = byType.get(block.type)
      // A slash means a plugin block. When that plugin is off or gone, keep the stored section.
      if (!def) {
        if (block.type.includes('/')) return block
        throw new BlockMigrationError(`Unknown section type "${block.type}".`)
      }
      if (block.v > def.version) throw new BlockMigrationError(`Section ${block.id} was written by a newer version (${block.type} v${block.v}).`)
      let props = block.props
      for (let v = block.v; v < def.version; v++) {
        const step = def.migrations?.[v]
        if (!step) throw new BlockMigrationError(`No migration for ${block.type} from v${v}.`)
        props = step(cloneDraft(props))
      }
      return props === block.props ? block : { ...block, v: def.version, props }
    },

    validate(block, pathPrefix = 'props') {
      const def = byType.get(block.type)
      if (!def) {
        if (block.type.includes('/')) return { ok: true, props: block.props }
        return { ok: false, issues: [{ path: 'type', message: `"${block.type}" is not an allowed section.` }] }
      }
      if (block.v !== def.version) return { ok: false, issues: [{ path: 'v', message: 'Section needs migrating before it can be checked.' }] }
      const parsed = def.props.safeParse(block.props)
      if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error, pathPrefix) }
      return { ok: true, props: parsed.data as Record<string, unknown> }
    },

    jsonSchema(type) {
      const def = byType.get(type)
      if (!def) throw new Error(`Unknown block type ${type}`)
      return z.toJSONSchema(def.props, { io: 'input' })
    },
  }
}

/** Core blocks plus any extra (site layer) blocks. */
export function createDefaultRegistry(extra: BlockDefinition[] = []): BlockRegistry {
  return createRegistry([...STARTER_BLOCKS, ...extra] as BlockDefinition[])
}
