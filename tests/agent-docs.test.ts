import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normaliseRules } from '../shared/agent/rules'
import { RULE_PRESETS } from '../shared/agent/presets'
import { buildOpenApi } from '../server/services/agent/openapi'
import { GATEWAY_DOC_PATH, OPENAPI_PATH, TOOLS_DOC_PATH, renderOpenApi, renderToolsDoc, withToolCount } from '../server/services/agent/docs-gen'
import { OPERATIONS } from '../server/services/agent/operations'
import { matchRoute } from '../server/utils/agent'

describe('generated reference docs', () => {
  it('are up to date (run npm run agent-docs)', () => {
    expect(readFileSync(TOOLS_DOC_PATH, 'utf8'), 'docs/agent-gateway-tools.md is stale: run npm run agent-docs').toBe(renderToolsDoc())
    expect(readFileSync(OPENAPI_PATH, 'utf8'), 'docs/agent-gateway-openapi.json is stale: run npm run agent-docs').toBe(renderOpenApi())
    const gateway = readFileSync(GATEWAY_DOC_PATH, 'utf8')
    expect(gateway, 'docs/agent-gateway.md tool count is stale: run npm run agent-docs').toBe(withToolCount(gateway))
    expect(gateway.match(/\*\*Tools\*\*: (\d+) of them/)?.[1]).toBe(String(OPERATIONS.length))
  })

  it('describe every operation once in the OpenAPI file, with a body or query schema', () => {
    const api = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, { operationId: string; parameters?: unknown[]; requestBody?: unknown }>> }
    expect(api.openapi).toBe('3.1.0')
    const ids = Object.values(api.paths).flatMap((p) => Object.values(p).map((o) => o.operationId))
    expect(ids.sort()).toEqual(OPERATIONS.map((o) => o.name).sort())
    for (const o of OPERATIONS) {
      const op = api.paths[o.path]![o.method.toLowerCase()]!
      expect(o.method === 'GET' ? true : !!op.requestBody, o.name).toBe(true)
    }
  })

  it('routes every operation to itself and refuses the wrong method', () => {
    for (const o of OPERATIONS) {
      const names = [...o.path.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!)
      const concrete = o.path.replace(/\{(\w+)\}/g, (_m, n: string) => `${n}_abc`)
      const m = matchRoute(o.method, concrete)
      expect(m && m !== 'wrong-method' && m.op.name, o.name).toBe(o.name)
      for (const n of names) expect(m && m !== 'wrong-method' && m.params[n], `${o.name} ${n}`).toBe(`${n}_abc`)
      expect(matchRoute(o.method === 'GET' ? 'POST' : 'GET', concrete)).toBe('wrong-method')
    }
    expect(matchRoute('GET', '/nothing')).toBeNull()
  })
})

describe('rule presets', () => {
  it('are valid rules', () => {
    for (const p of RULE_PRESETS) {
      expect(normaliseRules(p.rules).ok, p.key).toBe(true)
      if (p.access === 'read') expect(p.rules).toHaveLength(0)
    }
    expect(new Set(RULE_PRESETS.map((p) => p.key)).size).toBe(RULE_PRESETS.length)
  })
})
