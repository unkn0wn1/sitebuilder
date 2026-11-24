import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OPERATIONS } from '../server/services/agent/operations'
import { countOpenApiOperations, countToolRows } from '../scripts/docs-site-gen'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('docs-site generator', () => {
  it('counts the same tools and operations the gateway ships', () => {
    const tools = countToolRows(readFileSync(join(root, 'docs/agent-gateway-tools.md'), 'utf8'))
    const spec = JSON.parse(readFileSync(join(root, 'docs/agent-gateway-openapi.json'), 'utf8')) as {
      paths?: Record<string, Record<string, unknown>>
    }
    expect(tools).toBe(OPERATIONS.length)
    expect(countOpenApiOperations(spec)).toBe(OPERATIONS.length)
    const page = readFileSync(join(root, 'docs-site/reference/tools.md'), 'utf8')
    expect(page).toContain(`**${tools}** tools`)
    expect(page).toContain('generated')
    const api = readFileSync(join(root, 'docs-site/reference/api.md'), 'utf8')
    expect(api).toContain(`**${OPERATIONS.length}** operations`)
  })

  it('ships a plugins stub until docs/plugins.md exists', () => {
    expect(existsSync(join(root, 'docs/plugins.md'))).toBe(false)
    const page = readFileSync(join(root, 'docs-site/guide/plugins.md'), 'utf8')
    expect(page).toContain('coming with the plugins release')
  })
})
