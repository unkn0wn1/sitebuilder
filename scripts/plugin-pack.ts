#!/usr/bin/env tsx
// Pack a plugin source directory into a gzip ustar archive. This does not sign it.
//
//   npx tsx scripts/plugin-pack.ts plugins/official/match-thermometer --out match-thermometer-1.0.0.tar.gz
//
// Stdout is the content hash and the archive path. Errors go to stderr.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { packSource } from '../shared/plugins/repo'

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const source = process.argv[2]
if (!source || source.startsWith('-')) fail('Usage: plugin-pack.ts <source-dir> [--out file.tar.gz]')

let packed: ReturnType<typeof packSource>
try {
  packed = packSource(resolve(source))
} catch (error) {
  fail(error instanceof Error ? error.message : 'The source could not be packed.')
}

const out = resolve(arg('--out') ?? join(process.cwd(), `${packed.manifest.id}-${packed.manifest.version}.tar.gz`))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, packed.archive)
process.stdout.write(`contentHash: ${packed.hash.hex}\n`)
process.stdout.write(`archive: ${out}\n`)
