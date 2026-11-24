// Detached plugin signatures. Minisign's layout, not stock minisign.
// minisign -V will not verify these files: we sign the content hash, not the archive bytes.
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export interface OfficialKey {
  /** 16 lowercase hex chars. First 8 bytes of SHA-256 of the raw public key. */
  id: string
  /** Raw 32-byte Ed25519 public key, standard base64. */
  publicKey: string
}

export const SIGNATURE_MISMATCH = 'The signature does not match an official key.'
export const SIGNATURE_UNREADABLE = 'The signature file is not a sitebuilder plugin signature.'

const UNTRUSTED = 'untrusted comment: sitebuilder plugin signature'
const ALG = Buffer.from([0x45, 0x64])

export function officialKeyId(publicKey: Buffer): string {
  return createHash('sha256').update(publicKey).digest().subarray(0, 8).toString('hex')
}

export function rawEd25519PublicKey(key: KeyObject): Buffer {
  const der = Buffer.from(key.export({ format: 'der', type: 'spki' }))
  const raw = der.subarray(der.length - 32)
  if (raw.length !== 32) throw new Error('Ed25519 public key is not 32 bytes.')
  return raw
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' })
}

function decodeB64(text: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const buf = Buffer.from(text, 'base64')
  if (!buf.length) return null
  if (buf.toString('base64') !== text) return null
  return buf
}

interface ParsedSignature {
  keyId: string
  sigHash: Buffer
  sigGlobal: Buffer
  comment: string
}

function parseSignature(text: string): ParsedSignature | null {
  if (text.length > 4096 || text.includes('\r') || text.includes('\0')) return null
  let body = text
  if (body.endsWith('\n')) body = body.slice(0, -1)
  const lines = body.split('\n')
  if (lines.length !== 4) return null
  const [untrusted, payloadLine, commentLine, globalLine] = lines
  if (untrusted !== UNTRUSTED || !payloadLine || !commentLine || !globalLine) return null
  if (!commentLine.startsWith('trusted comment: ')) return null
  const comment = commentLine.slice('trusted comment: '.length)
  if (!comment) return null
  const payload = decodeB64(payloadLine)
  const sigGlobal = decodeB64(globalLine)
  if (!payload || payload.length !== 2 + 8 + 64) return null
  if (!sigGlobal || sigGlobal.length !== 64) return null
  if (!payload.subarray(0, 2).equals(ALG)) return null
  const keyId = payload.subarray(2, 10).toString('hex')
  if (!/^[0-9a-f]{16}$/.test(keyId)) return null
  return { keyId, sigHash: payload.subarray(10), sigGlobal, comment }
}

function expectedComment(pluginId: string, version: string, hex: string): string {
  return `plugin=${pluginId} version=${version} hash=${hex}`
}

function verified(key: KeyObject, message: Buffer, signature: Buffer): boolean {
  try {
    return verify(null, message, key, signature)
  } catch {
    return false
  }
}

function findKey(id: string, keys: readonly OfficialKey[]): Buffer | null {
  for (const key of keys) {
    if (key.id !== id) continue
    const raw = Buffer.from(key.publicKey, 'base64')
    if (raw.length !== 32) continue
    if (officialKeyId(raw) !== id) continue
    return raw
  }
  return null
}

export interface TrustInput {
  /** Null when the install has no signature file. */
  signature: string | null
  contentHash: Buffer
  pluginId: string
  version: string
  keys: readonly OfficialKey[]
}

export type TrustDecision =
  | { ok: true; trust: 'official'; keyId: string }
  | { ok: true; trust: 'self'; keyId: string | null }
  | { ok: false; message: string }

/**
 * No signature: Self-installed.
 * Known key, both signatures verify, comment matches: Official.
 * Known key, verify fails or the comment disagrees: hard reject.
 * Unknown key id that still parses: Self-installed. The comment is ignored and not verified.
 * Unparseable: hard reject. Never fall through to Self-installed.
 */
export function decideTrust(input: TrustInput): TrustDecision {
  if (input.signature === null) return { ok: true, trust: 'self', keyId: null }
  const parsed = parseSignature(input.signature)
  if (!parsed) return { ok: false, message: SIGNATURE_UNREADABLE }
  const known = findKey(parsed.keyId, input.keys)
  if (!known) return { ok: true, trust: 'self', keyId: parsed.keyId }
  const comment = expectedComment(input.pluginId, input.version, input.contentHash.toString('hex'))
  if (parsed.comment !== comment) return { ok: false, message: SIGNATURE_MISMATCH }
  const key = publicKeyFromRaw(known)
  const globalMessage = Buffer.concat([parsed.sigHash, Buffer.from(comment, 'utf8')])
  if (!verified(key, input.contentHash, parsed.sigHash)) return { ok: false, message: SIGNATURE_MISMATCH }
  if (!verified(key, globalMessage, parsed.sigGlobal)) return { ok: false, message: SIGNATURE_MISMATCH }
  return { ok: true, trust: 'official', keyId: parsed.keyId }
}

export function signPluginSignature(input: {
  privateKey: KeyObject
  publicKey: Buffer
  contentHash: Buffer
  pluginId: string
  version: string
}): string {
  if (input.publicKey.length !== 32 || input.contentHash.length !== 32) {
    throw new Error('Plugin signing needs a 32-byte key and a 32-byte content hash.')
  }
  const keyId = officialKeyId(input.publicKey)
  const sigHash = sign(null, input.contentHash, input.privateKey)
  const comment = expectedComment(input.pluginId, input.version, input.contentHash.toString('hex'))
  const sigGlobal = sign(null, Buffer.concat([sigHash, Buffer.from(comment, 'utf8')]), input.privateKey)
  const payload = Buffer.concat([ALG, Buffer.from(keyId, 'hex'), sigHash])
  return [UNTRUSTED, payload.toString('base64'), `trusted comment: ${comment}`, sigGlobal.toString('base64'), ''].join('\n')
}
