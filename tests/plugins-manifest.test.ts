import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseManifest } from '../shared/plugins/manifest'
import { CORE_VERSION, compareSemver, parseSemver, satisfiesCore } from '../shared/plugins/semver'

const files = new Map<string, Buffer>([['note.html', Buffer.from('<section>Hello</section>')]])

function block(over: Record<string, unknown> = {}) {
  return {
    type: 'Note',
    v: 1,
    label: 'Note',
    category: 'Text',
    props: { type: 'object', fields: { heading: { type: 'string', max: 80, required: true } } },
    template: 'note.html',
    example: { heading: 'Hello' },
    ...over,
  }
}

function manifest(over: Record<string, unknown> = {}) {
  return {
    id: 'hello-note',
    name: 'Hello note',
    version: '1.0.0',
    sitebuilder: '>=0.1.0 <0.2.0',
    permissions: ['blocks'],
    csp: { img: [], frame: [], script: [], connect: [], font: [] },
    blocks: [block()],
    ...over,
  }
}

function issuesOf(raw: unknown) {
  const parsed = parseManifest(raw, files)
  if (parsed.ok) return []
  return parsed.issues
}

describe('plugin manifests', () => {
  it('accepts a small declarative package', () => {
    const parsed = parseManifest(manifest(), files)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.manifest.id).toBe('hello-note')
    expect(parsed.value.manifest.blocks[0]?.agent).toEqual({ writable: false, describe: '' })
    expect(parsed.value.origins).toEqual([])
  })

  it('rejects an extra key, a bad id, script origins and an http origin', () => {
    expect(issuesOf({ ...manifest(), marketplace: true })).toContainEqual({ path: 'marketplace', message: 'This field is not allowed.' })

    const badId = issuesOf(manifest({ id: 'NOT-OK' }))
    expect(badId).toContainEqual({ path: 'id', message: 'Use a short name: a letter, then lowercase letters, numbers or hyphens.' })
    expect(JSON.stringify(badId).includes('NOT-OK')).toBe(false)

    const scripts = issuesOf(manifest({ csp: { img: [], frame: [], script: ['https://cdn.example'], connect: [], font: [] } }))
    expect(scripts.some((issue) => issue.message === 'This plugin asks to load scripts. Version 1 plugins cannot add scripts.')).toBe(true)
    expect(JSON.stringify(scripts).includes('cdn.example')).toBe(false)

    const http = issuesOf(manifest({ csp: { img: ['http://images.example'], frame: [], script: [], connect: [], font: [] } }))
    expect(http).toContainEqual({ path: 'csp.img.0', message: 'Use an https address with a host and no path.' })
    expect(JSON.stringify(http).includes('images.example')).toBe(false)
  })

  it('rejects a core range that excludes this version, banned schema and a migration gap', () => {
    const range = issuesOf(manifest({ sitebuilder: '>=0.2.0 <0.3.0' }))
    expect(range).toContainEqual({ path: 'sitebuilder', message: 'This plugin does not support this version of sitebuilder.' })
    expect(JSON.stringify(range).includes('0.2.0')).toBe(false)

    const refProps = { type: 'object', fields: { heading: { $ref: '#/defs/heading' } } }
    const refIssues = issuesOf(manifest({ blocks: [block({ props: refProps })] }))
    expect(refIssues.some((issue) => issue.message === 'This schema feature is not allowed.')).toBe(true)
    expect(JSON.stringify(refIssues).includes('#/defs')).toBe(false)

    const patternProps = { type: 'object', fields: { heading: { type: 'string', max: 80, pattern: 'secret-pattern', required: true } } }
    const patternIssues = issuesOf(manifest({ blocks: [block({ props: patternProps, example: { heading: 'Hello' } })] }))
    expect(patternIssues.some((issue) => issue.message === 'This schema feature is not allowed.')).toBe(true)
    expect(JSON.stringify(patternIssues).includes('secret-pattern')).toBe(false)

    const gap = issuesOf(manifest({
      blocks: [block({ v: 3 })],
      migrations: { Note: { '1->2': 'rename:title->heading' } },
    }))
    expect(gap.some((issue) => issue.message === 'The migrations skip a version.')).toBe(true)
  })

  it('rejects a long agent description and an unknown agentNever name', () => {
    const described = issuesOf(manifest({ blocks: [block({ agent: { describe: 'a'.repeat(201) } })] }))
    expect(described).toContainEqual({ path: 'blocks.0.agent.describe', message: 'Keep this under 200 characters.' })
    const never = issuesOf(manifest({ blocks: [block({ agentNever: ['missingProp'] })] }))
    expect(never).toContainEqual({ path: 'blocks.0.agentNever.0', message: 'This name is not a prop on the block.' })
  })

  it('parses this core version and plain semver', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(CORE_VERSION).toBe(pkg.version)
    expect(parseSemver('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 })
    expect(parseSemver('01.0.0')).toBeNull()
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1)
    expect(compareSemver('1.2.0', 'nope')).toBeNull()
    expect(satisfiesCore('>=0.1.0 <0.2.0')).toBe(true)
    expect(satisfiesCore('>=0.2.0')).toBe(false)
  })
})
