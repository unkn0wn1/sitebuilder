// Canonical plugin content hash. ADR 0020 records this byte for byte.
import { createHash } from 'node:crypto'

export interface HashFile {
  path: string
  bytes: Buffer
}

export interface ContentHash {
  /** Raw 32-byte SHA-256. Signatures cover these bytes, not the hex form. */
  raw: Buffer
  /** Lowercase hex, 64 characters. */
  hex: string
}

function compareBytes(a: Buffer, b: Buffer): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return a.length - b.length
}

/**
 * Hash the file list. Directories are not entries.
 * Each record is UTF-8(path) || 0x00 || raw SHA-256(file bytes).
 * Records are sorted by the raw path bytes, unsigned, then concatenated with no extra separator.
 * The content hash is SHA-256 of that concatenation.
 * Tar order, ustar mtime and gzip headers are not inputs.
 */
export function contentHash(files: readonly HashFile[]): ContentHash {
  const records = files.map((file) => {
    const pathBytes = Buffer.from(file.path, 'utf8')
    const fileHash = createHash('sha256').update(file.bytes).digest()
    return { pathBytes, record: Buffer.concat([pathBytes, Buffer.from([0]), fileHash]) }
  })
  records.sort((a, b) => compareBytes(a.pathBytes, b.pathBytes))
  const raw = createHash('sha256')
    .update(Buffer.concat(records.map((entry) => entry.record)))
    .digest()
  return { raw, hex: raw.toString('hex') }
}
