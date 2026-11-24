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

  it('publishes docs/plugins.md with links that resolve on the docs site', () => {
    expect(existsSync(join(root, 'docs/plugins.md'))).toBe(true)
    const page = readFileSync(join(root, 'docs-site/guide/plugins.md'), 'utf8')
    expect(page).toContain('declarative package')
    expect(page).toContain('https://github.com/unkn0wn1/sitebuilder/blob/main/docs/decisions/0020-plugins.md')
    expect(page).toContain('https://github.com/unkn0wn1/sitebuilder/blob/main/docs/11-theming.md')
    expect(page).not.toContain('](decisions/')
    expect(page).not.toContain('](11-theming.md)')
  })
})
