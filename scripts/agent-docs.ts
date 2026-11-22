#!/usr/bin/env tsx
// Regenerate docs/agent-gateway-tools.md and docs/agent-gateway-openapi.json from the operation table.
//   npm run agent-docs
import { writeFileSync } from 'node:fs'
import { OPENAPI_PATH, TOOLS_DOC_PATH, renderOpenApi, renderToolsDoc } from '../server/services/agent/docs-gen'

writeFileSync(TOOLS_DOC_PATH, renderToolsDoc())
writeFileSync(OPENAPI_PATH, renderOpenApi())
console.log(`Wrote ${TOOLS_DOC_PATH} and ${OPENAPI_PATH}.`)
