#!/usr/bin/env tsx
// Regenerate docs/agent-gateway-tools.md and docs/agent-gateway-openapi.json from the operation table,
// and set the tool count in docs/agent-gateway.md from OPERATIONS.length.
//   npm run agent-docs
import { readFileSync, writeFileSync } from 'node:fs'
import { GATEWAY_DOC_PATH, OPENAPI_PATH, TOOLS_DOC_PATH, renderOpenApi, renderToolsDoc, withToolCount } from '../server/services/agent/docs-gen'

writeFileSync(TOOLS_DOC_PATH, renderToolsDoc())
writeFileSync(OPENAPI_PATH, renderOpenApi())
writeFileSync(GATEWAY_DOC_PATH, withToolCount(readFileSync(GATEWAY_DOC_PATH, 'utf8')))
console.log(`Wrote ${TOOLS_DOC_PATH}, ${OPENAPI_PATH}, and the tool count in ${GATEWAY_DOC_PATH}.`)
