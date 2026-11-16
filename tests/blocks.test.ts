import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineBlock, text } from '../shared/blocks/define'
import { createDefaultRegistry, createRegistry } from '../shared/blocks/registry'
import { STARTER_BLOCKS } from '../shared/blocks/library'
import { migratePageDoc, PageMigrationError } from '../shared/page'

describe('block registry', () => {
  const registry = createDefaultRegistry()

  it('every starter block validates its own sample and produces JSON Schema', () => {
    for (const def of STARTER_BLOCKS) {
      const res = registry.validate({ id: 'b_test1', type: def.type, v: def.version, props: def.sample as Record<string, unknown> })
      expect(res.ok, def.type).toBe(true)
      expect(registry.jsonSchema(def.type)).toHaveProperty('type', 'object')
    }
  })

  it('gives plain-English issues with paths', () => {
    const res = registry.validate({ id: 'b_test1', type: 'Hero', v: 1, props: { heading: 'x'.repeat(81), image: { media: 'nope' } } }, 'blocks.0.props')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.issues.map((i) => i.path)).toContain('blocks.0.props.heading')
      expect(res.issues.find((i) => i.path === 'blocks.0.props.heading')?.message).toMatch(/under 80/)
    }
  })

  it('migrates old blocks forward on read', () => {
    const v1 = { type: 'Banner', version: 1, label: 'Banner', category: 'Text' as const, props: z.object({ title: text({ max: 50, required: true }) }), sample: { title: 'x' } }
    const v2 = defineBlock({
      ...v1,
      version: 2,
      props: z.object({ heading: text({ max: 50, required: true }), tone: z.enum(['a', 'b']) }),
      migrations: { 1: ({ title, ...rest }) => ({ ...rest, heading: title, tone: 'a' }) },
      sample: { heading: 'x', tone: 'a' },
    })
    const reg = createRegistry([v2])
    const migrated = reg.migrate({ id: 'b_abcd', type: 'Banner', v: 1, props: { title: 'Old' } })
    expect(migrated).toEqual({ id: 'b_abcd', type: 'Banner', v: 2, props: { heading: 'Old', tone: 'a' } })
    expect(reg.validate(migrated).ok).toBe(true)

    const doc = migratePageDoc({ schemaVersion: 1, title: 'T', seo: {}, blocks: [{ id: 'b_abcd', type: 'Banner', v: 1, props: { title: 'Old' } }] }, reg)
    expect(doc.blocks[0]!.v).toBe(2)
  })

  it('refuses blocks from a newer version and documents from the future', () => {
    expect(() => registry.migrate({ id: 'b_abcd', type: 'Hero', v: 99, props: {} })).toThrow(/newer/)
    expect(() => migratePageDoc({ schemaVersion: 99, title: 'T', seo: {}, blocks: [] }, registry)).toThrow(PageMigrationError)
  })

  it('a block without a migration path cannot be defined', () => {
    expect(() => defineBlock({ type: 'X', version: 2, label: 'X', category: 'Text', props: z.object({}), sample: {} })).toThrow(/no migration/)
  })
})
