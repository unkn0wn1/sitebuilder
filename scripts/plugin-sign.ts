#!/usr/bin/env tsx
// Sign a plugin archive with the key in SITEBUILDER_PLUGIN_SIGNING_KEY. There is no default path.
// The signature file is mode 0o644. Stdout is the id, version, content hash and key id.
// The private key is never printed.
//
//   SITEBUILDER_PLUGIN_SIGNING_KEY=/path/outside/the/repo npx tsx scripts/plugin-sign.ts plugin.tar.gz --out plugin.tar.gz.sig
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { closeSync, fchmodSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readTarGz } from '../shared/plugins/archive'
import { contentHash } from '../shared/plugins/hash'
import { officialKeyId, rawEd25519PublicKey, signPluginSignature } from '../shared/plugins/signature'

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const archivePath = process.argv[2]
if (!archivePath || archivePath.startsWith('-')) fail('Usage: plugin-sign.ts <archive.tar.gz> [--out file.sig]')
const keyPath = process.env.SITEBUILDER_PLUGIN_SIGNING_KEY
if (!keyPath) fail('Set SITEBUILDER_PLUGIN_SIGNING_KEY to a PKCS8 PEM outside this repository.')

let pem: string
try {
  pem = readFileSync(keyPath, 'utf8')
} catch {
  fail('The signing key could not be read.')
}

let archive: Buffer
try {
  archive = readFileSync(resolve(archivePath))
} catch {
  fail('The archive could not be read.')
}

let files: { path: string; bytes: Buffer }[]
try {
  files = readTarGz(archive).files
} catch {
  fail('The archive could not be read.')
}
const manifestFile = files.find((file) => file.path === 'plugin.json')
if (!manifestFile) fail('The archive must include plugin.json.')
let manifest: { id?: unknown; version?: unknown }
try {
  manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.bytes)) as { id?: unknown; version?: unknown }
} catch {
  fail('plugin.json is not valid JSON.')
}
if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') fail('plugin.json needs an id and a version.')

let raw: Buffer
let privateKey: ReturnType<typeof createPrivateKey>
try {
  privateKey = createPrivateKey(pem)
  raw = rawEd25519PublicKey(createPublicKey(privateKey))
} catch {
  fail('The signing key could not be read.')
}

const hashed = contentHash(files)
const signature = signPluginSignature({
  privateKey,
  publicKey: raw,
  contentHash: hashed.raw,
  pluginId: manifest.id,
  version: manifest.version,
})
const out = resolve(arg('--out') ?? `${resolve(archivePath)}.sig`)
mkdirSync(dirname(out), { recursive: true })
const fd = openSync(out, 'w', 0o644)
try {
  fchmodSync(fd, 0o644)
  writeSync(fd, signature)
} finally {
  closeSync(fd)
}
process.stdout.write(`id: ${manifest.id}\n`)
process.stdout.write(`version: ${manifest.version}\n`)
process.stdout.write(`contentHash: ${hashed.hex}\n`)
process.stdout.write(`keyId: ${officialKeyId(raw)}\n`)
