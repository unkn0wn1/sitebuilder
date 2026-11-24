#!/usr/bin/env tsx
// Write an Ed25519 PKCS8 PEM for official plugin signing, or print the public key of an existing file.
// Stdout is only `publicKey:` and `keyId:`. The private key is never printed.
//
//   SITEBUILDER_PLUGIN_SIGNING_KEY=/path/outside/the/repo npx tsx scripts/plugin-keygen.ts
//   SITEBUILDER_PLUGIN_SIGNING_KEY=/path/outside/the/repo npx tsx scripts/plugin-keygen.ts --public
//
// The path is SITEBUILDER_PLUGIN_SIGNING_KEY, or ~/.config/sitebuilder/official-signing.key.
// A path inside this repository is refused, including a symlink that lands inside it.
// An existing file is not overwritten. Mode is 0o600.
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto'
import { closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, statSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { officialKeyId, rawEd25519PublicKey } from '../shared/plugins/signature'

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function landedPath(input: string): string {
  const abs = resolve(input)
  try {
    if (lstatSync(abs).isSymbolicLink()) return resolve(dirname(abs), readlinkSync(abs))
  } catch {
    // The file is not there yet.
  }
  return abs
}

function realKeyPath(input: string): string {
  const landed = landedPath(input)
  try {
    return realpathSync(landed)
  } catch {
    const parent = dirname(landed)
    let parentReal = parent
    try {
      parentReal = realpathSync(parent)
    } catch {
      parentReal = resolve(parent)
    }
    return join(parentReal, basename(landed))
  }
}

function repoRoot(): string {
  try {
    return realpathSync(process.cwd())
  } catch {
    return resolve(process.cwd())
  }
}

function printPublic(raw: Buffer) {
  process.stdout.write(`publicKey: ${raw.toString('base64')}\n`)
  process.stdout.write(`keyId: ${officialKeyId(raw)}\n`)
}

function publicFromPem(pem: string): Buffer {
  const privateKey = createPrivateKey(pem)
  return rawEd25519PublicKey(createPublicKey(privateKey))
}

const requested = process.env.SITEBUILDER_PLUGIN_SIGNING_KEY
const keyPath = requested && requested.trim() ? requested : join(process.env.HOME || homedir(), '.config', 'sitebuilder', 'official-signing.key')
const real = realKeyPath(keyPath)
if (isInside(repoRoot(), real)) fail('The signing key must live outside this repository.')

const showPublic = process.argv.includes('--public')
if (showPublic) {
  let pem: string
  try {
    pem = readFileSync(real, 'utf8')
  } catch {
    fail('No signing key at that path.')
  }
  try {
    printPublic(publicFromPem(pem))
  } catch {
    fail('The signing key could not be read.')
  }
  process.exit(0)
}

try {
  statSync(real)
  fail('Refusing to overwrite the signing key.')
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code
  if (code !== 'ENOENT') fail('The signing key could not be written.')
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const raw = rawEd25519PublicKey(publicKey)
mkdirSync(dirname(real), { recursive: true, mode: 0o700 })
const fd = openSync(real, 'wx', 0o600)
try {
  fchmodSync(fd, 0o600)
  writeSync(fd, pem)
} catch {
  fail('The signing key could not be written.')
} finally {
  closeSync(fd)
}
printPublic(raw)
