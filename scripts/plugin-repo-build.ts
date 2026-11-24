#!/usr/bin/env tsx
// Build a plugin repository: index.json, index.json.sig, index.html, and packages/<id>/<version>/.
// Each child of the source directory is one plugin source. The signing key is SITEBUILDER_PLUGIN_SIGNING_KEY.
//
//   SITEBUILDER_PLUGIN_SIGNING_KEY=/path/outside/the/repo npx tsx scripts/plugin-repo-build.ts --source plugins/official --out /tmp/plugin-repo
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { contentHash } from '../shared/plugins/hash'
import { readTarGz } from '../shared/plugins/archive'
import { buildRepositoryFiles, packSource, type BuiltPackage } from '../shared/plugins/repo'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature } from '../shared/plugins/signature'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const source = resolve(arg('--source') ?? 'plugins/official')
const out = arg('--out')
if (!out) fail('Usage: plugin-repo-build.ts [--source plugins/official] --out <dir>')
const keyPath = process.env.SITEBUILDER_PLUGIN_SIGNING_KEY
if (!keyPath) fail('Set SITEBUILDER_PLUGIN_SIGNING_KEY to a PKCS8 PEM outside this repository.')

let privateKey: ReturnType<typeof createPrivateKey>
let raw: Buffer
try {
  privateKey = createPrivateKey(readFileSync(keyPath, 'utf8'))
  raw = rawEd25519PublicKey(createPublicKey(privateKey))
} catch {
  fail('The signing key could not be read.')
}
const keyId = officialKeyId(raw)

let names: string[]
try {
  names = readdirSync(source).filter((name) => statSync(join(source, name)).isDirectory()).sort()
} catch {
  fail('The source directory could not be read.')
}
if (!names.length) fail('The source directory has no plugins.')

const packages: BuiltPackage[] = []
for (const name of names) {
  let packed: ReturnType<typeof packSource>
  try {
    packed = packSource(join(source, name))
  } catch (error) {
    fail(error instanceof Error ? error.message : `Could not pack ${name}.`)
  }
  const files = readTarGz(packed.archive).files
  const hashed = contentHash(files)
  const signature = signPluginSignature({
    privateKey,
    publicKey: raw,
    contentHash: hashed.raw,
    pluginId: packed.manifest.id,
    version: packed.manifest.version,
  })
  packages.push({
    id: packed.manifest.id,
    name: packed.manifest.name,
    version: packed.manifest.version,
    core: packed.manifest.sitebuilder,
    contentHash: hashed.hex,
    keyId,
    archive: packed.archive,
    signature,
  })
}

const files = buildRepositoryFiles({ packages, privateKey, publicKey: raw })
const root = resolve(out)
for (const file of files) {
  const abs = join(root, file.path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, file.bytes, { mode: 0o644 })
}
process.stdout.write(`plugins: ${packages.length}\n`)
process.stdout.write(`keyId: ${keyId}\n`)
process.stdout.write(`out: ${root}\n`)
