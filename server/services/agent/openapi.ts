// OpenAPI 3.1 for the REST side of the gateway, generated from the same operation table the MCP server uses.
import { ERROR_CATALOG, OPERATIONS, inputJsonSchema, toolDescription, type Operation } from './operations'
import { SERVER_VERSION } from './mcp'

type Schema = { properties?: Record<string, Record<string, unknown>>; required?: string[]; [k: string]: unknown }

const STATUS_DESCRIPTIONS = new Map<number, string>()
for (const e of ERROR_CATALOG) STATUS_DESCRIPTIONS.set(e.http, [STATUS_DESCRIPTIONS.get(e.http), `${e.code}: ${e.meaning} ${e.recovery}`].filter(Boolean).join('\n\n'))

function pathParams(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
}

function operationObject(o: Operation) {
  const schema = inputJsonSchema(o) as Schema
  const inPath = pathParams(o.path)
  const props = { ...(schema.properties ?? {}) }
  for (const p of inPath) delete props[p]
  const required = (schema.required ?? []).filter((r) => !inPath.includes(r))
  const parameters: unknown[] = inPath.map((name) => ({ name, in: 'path', required: true, description: String(schema.properties?.[name]?.description ?? ''), schema: { type: 'string' } }))
  const base = {
    operationId: o.name,
    summary: o.doc.summary,
    description: toolDescription(o),
    tags: [o.level === 'read' ? 'Read' : o.level === 'draft' ? 'Edit (drafts)' : 'Decide'],
    security: [{ bearer: [] }],
    responses: {
      '200': { description: o.doc.returns, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      ...Object.fromEntries([...STATUS_DESCRIPTIONS.keys()].map((status) => [String(status), { $ref: `#/components/responses/Error${status}` }])),
    },
    'x-example-input': o.doc.example.input,
  }
  if (o.method === 'GET') {
    for (const [name, def] of Object.entries(props)) parameters.push({ name, in: 'query', required: required.includes(name), description: def.description, schema: def })
    return { ...base, parameters }
  }
  return {
    ...base,
    ...(parameters.length ? { parameters } : {}),
    requestBody: { required: true, content: { 'application/json': { schema: { ...schema, properties: props, required }, example: o.doc.example.input } } },
  }
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const o of OPERATIONS) (paths[o.path] ??= {})[o.method.toLowerCase()] = operationObject(o)
  return {
    openapi: '3.1.0',
    info: {
      title: 'Skewstone agent API',
      version: SERVER_VERSION,
      description:
        'Read and change the charity website with a scoped token. Every edit is saved as a draft inside a change; nothing goes live until publish_change (if a rule on the token allows it) or a person approves it. The same tools are available over MCP at /agent/mcp. Start with GET /site. Docs: docs/agent-gateway.md.',
    },
    servers: [{ url: '/agent/v1' }],
    security: [{ bearer: [] }],
    tags: [
      { name: 'Read', description: 'Never changes anything.' },
      { name: 'Edit (drafts)', description: 'Saves a draft inside a change. Never changes the live site.' },
      { name: 'Decide', description: 'Sends, publishes, discards or undoes a change.' },
    ],
    paths,
    components: {
      responses: Object.fromEntries([...STATUS_DESCRIPTIONS].map(([status, description]) => [`Error${status}`, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])),
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'A token starting sbt_, made by an admin. Sent as "Authorization: Bearer sbt_...".' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: ERROR_CATALOG.map((e) => e.code), description: 'What went wrong, in a form you can act on. See each response for what to do.' },
                message: { type: 'string', description: 'A sentence saying what happened and often what to do.' },
                fields: { type: 'array', description: 'For validation_failed: each input that was wrong.', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
                retryAfterSeconds: { type: 'integer', description: 'For rate_limited: how long to wait.' },
              },
              additionalProperties: true,
            },
          },
        },
      },
    },
  }
}
