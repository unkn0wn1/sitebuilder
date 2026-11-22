import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pluginCatalog } from '../server/services/plugins/catalog'
import { createDefaultRegistry } from '../shared/blocks/registry'
import { runChecks } from '../shared/checks'
import { emptyPageDoc } from '../shared/page'
import { blockDefinitions, type PluginManifest } from '../shared/plugins/manifest'

function manifest(): PluginManifest {
  return {
    id: 'hello-note',
    name: 'Hello note',
    version: '1.0.0',
    sitebuilder: '>=0.1.0 <0.2.0',
    permissions: ['blocks'],
    csp: { img: [], frame: [], script: [], connect: [], font: [] },
    head: [],
    blocks: [{
      type: 'Note',
      v: 1,
      label: 'Note',
      category: 'Text',
      props: {
        type: 'object',
        fields: {
          heading: { type: 'string', max: 80, required: true },
          raised: { type: 'number', required: true },
        },
      },
      template: 'note.html',
      example: { heading: 'Hello', raised: 12 },
      computed: [],
      agent: { writable: false, describe: 'A short note' },
      agentNever: [],
      money: false,
      imageSlots: { photo: { width: 800, height: 600 } },
    }],
  }
}

describe('plugin catalog', () => {
  it('lists enabled plugin blocks and describes number fields', () => {
    const defs = blockDefinitions(manifest(), 'official')
    const blocks = pluginCatalog(createDefaultRegistry(defs))
    expect(blocks.map((block) => block.type)).toEqual(['hello-note/Note'])
    expect(blocks[0]).toMatchObject({
      label: 'Note',
      category: 'Text',
      trust: 'Official',
      sample: { heading: 'Hello', raised: 12 },
      imageSlots: { photo: { width: 800, height: 600 } },
    })
    const byName = Object.fromEntries(blocks[0]!.fields.map((field) => [field.name, field]))
    expect(byName.heading).toMatchObject({ kind: 'text', max: 80, optional: false, label: 'Heading' })
    expect(byName.raised).toMatchObject({ kind: 'number', label: 'Raised so far', optional: false })
    expect(byName.raised?.kind).not.toBe('unknown')
  })

  it('uses the self-installed trust label and skips core blocks', () => {
    const [note] = blockDefinitions(manifest(), 'self')
    const blocks = pluginCatalog(createDefaultRegistry([note!]))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.trust).toBe('Self-installed')
    expect(blocks.some((block) => block.type === 'Hero')).toBe(false)
    expect(pluginCatalog(createDefaultRegistry())).toEqual([])
  })

  it('lets any signed-in user read the catalog', () => {
    const src = readFileSync(new URL('../server/api/v1/plugins/catalog.get.ts', import.meta.url), 'utf8')
    expect(src).toContain('requireActor(event)')
    expect(src).not.toContain('requireCan')
  })

  it('warns when a plugin section has no plugin, and does not block review', () => {
    const doc = emptyPageDoc('Missing')
    doc.blocks = [{ id: 'b_miss0001', type: 'missing/Widget', v: 1, props: { heading: 'Hello' } }]
    const missing = runChecks(doc, createDefaultRegistry(), null)
    expect(missing.warnings).toContainEqual({ path: 'blocks.0.type', message: 'Plugin missing. This section is left out of the published page.' })
    expect(missing.blocking.some((issue) => issue.path === 'blocks.0.type')).toBe(false)

    const other = runChecks(doc, createDefaultRegistry(blockDefinitions(manifest(), 'self')), null)
    expect(other.warnings).toContainEqual({ path: 'blocks.0.type', message: 'Plugin missing. This section is left out of the published page.' })
    doc.blocks = [{ id: 'b_note0001', type: 'hello-note/Note', v: 1, props: { heading: 'Hello', raised: 12 } }]
    const enabled = runChecks(doc, createDefaultRegistry(blockDefinitions(manifest(), 'self')), null)
    expect(enabled.warnings.some((issue) => issue.message === 'Plugin missing. This section is left out of the published page.')).toBe(false)
    expect(enabled.blocking.some((issue) => issue.message === 'Plugin missing. This section is left out of the published page.')).toBe(false)
  })
})
