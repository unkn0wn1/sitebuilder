// Copy shared/soul/soul.md into shared/soul/default-soul.ts, so the default personality loads the same way in Nuxt,
// Nitro, vitest and plain tsx scripts (no ?raw loader). Run after editing soul.md: npm run soul-default.
// tests/soul.test.ts fails if the two differ.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const md = fileURLToPath(new URL('../shared/soul/soul.md', import.meta.url))
const out = fileURLToPath(new URL('../shared/soul/default-soul.ts', import.meta.url))
const text = readFileSync(md, 'utf8')
writeFileSync(out, `// Generated from soul.md by \`npm run soul-default\`. Edit soul.md, not this file.\nexport const DEFAULT_SOUL_TEXT = ${JSON.stringify(text)}\n`)
console.log('Wrote shared/soul/default-soul.ts')
