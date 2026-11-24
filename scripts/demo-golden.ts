// Build the public-demo golden snapshot. Usage: npm run demo:golden
// SITEBUILDER_DEMO_ROOT  parent of golden/ (default .data/demo)
import { join } from 'node:path'
import { buildDemoGolden } from '../server/services/demo-golden'

const root = process.env.SITEBUILDER_DEMO_ROOT ?? join('.data', 'demo')
const golden = await buildDemoGolden(root, { readOnly: true })
console.log(`demo golden: ${golden}`)
