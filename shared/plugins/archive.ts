// Gzip ustar reader and writer for plugin packages. Node zlib only. ADR 0020.
import { gzipSync, gunzipSync, type ZlibOptions } from 'node:zlib'
import {
  PLUGIN_ARCHIVE_MAX_BYTES,
  PLUGIN_CSS_MAX_BYTES,
  PLUGIN_FILE_MAX_BYTES,
  PLUGIN_MANIFEST_MAX_BYTES,
  PLUGIN_MAX_DEPTH,
  PLUGIN_MAX_FILES,
  PLUGIN_PATH_MAX_BYTES,
  PLUGIN_TEMPLATE_MAX_BYTES,
  PLUGIN_UNCOMPRESSED_MAX_BYTES,
} from './limits'

export class ArchiveError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.path = path
  }
}

export interface ArchiveFile {
  path: string
  bytes: Buffer
}

const PATH_REJECTED = 'A file path in the archive is not allowed.'
const UNREADABLE = 'The archive could not be read.'
const TOO_BIG = 'The archive is over the size limit.'
const FILE_TOO_BIG = 'This file is over the size limit.'
const BAD_TYPE = 'This file type is not allowed.'
const NOT_A_FILE = 'This archive entry is not a regular file.'
const DUPLICATE = 'This file is listed twice.'
const TOO_MANY = 'The archive has too many files.'
const TOO_LONG = 'This file path is too long.'
const TOO_DEEP = 'This file is nested too deeply.'
const NEED_MANIFEST = 'The archive must include plugin.json.'

const ALLOWED_SUFFIXES = new Set(['.html', '.css', '.svg', '.png', '.webp', '.avif', '.gif'])

function gunzipCapped(gz: Buffer): Buffer {
  if (gz.length > PLUGIN_ARCHIVE_MAX_BYTES) throw new ArchiveError('(archive)', TOO_BIG)
  if (gz.length < 10 || gz[0] !== 0x1f || gz[1] !== 0x8b) throw new ArchiveError('(archive)', UNREADABLE)
  try {
    return gunzipSync(gz, { maxOutputLength: PLUGIN_UNCOMPRESSED_MAX_BYTES })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
    if (code === 'ERR_BUFFER_TOO_LARGE') throw new ArchiveError('(archive)', TOO_BIG)
    throw new ArchiveError('(archive)', UNREADABLE)
  }
}

function headerChecksum(header: Buffer): number {
  let sum = 0
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0)
  return sum
}

function readOctal(buf: Buffer, offset: number, length: number): number | null {
  const raw = buf.subarray(offset, offset + length)
  if ((raw[0] ?? 0) & 0x80) return null
  let text = ''
  for (const byte of raw) {
    if (byte === 0 || byte === 32) continue
    text += String.fromCharCode(byte)
  }
  if (!text || !/^[0-7]+$/.test(text)) return null
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value)) return null
  return value
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, '0').slice(0, length - 1)
  buf.write(text, offset, length - 1, 'ascii')
  buf[offset + length - 1] = 0
}

function writeChecksum(header: Buffer) {
  header.fill(0x20, 148, 156)
  const text = headerChecksum(header).toString(8).padStart(6, '0')
  header.write(text, 148, 6, 'ascii')
  header[154] = 0
  header[155] = 32
}

function readField(buf: Buffer, start: number, length: number): { text: string; embeddedNul: boolean } {
  const slice = buf.subarray(start, start + length)
  const end = slice.indexOf(0)
  const stop = end === -1 ? slice.length : end
  for (let i = stop + 1; i < slice.length; i++) {
    if ((slice[i] ?? 0) !== 0) return { text: '', embeddedNul: true }
  }
  return { text: slice.subarray(0, stop).toString('utf8'), embeddedNul: false }
}

/** Null when the path is not allowed. The rejected text is not returned. */
export function normaliseArchivePath(input: string): string | null {
  let path = input.normalize('NFC')
  if (path.includes('\0') || path.includes('\\')) return null
  while (path.startsWith('./')) path = path.slice(2)
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return parts.join('/')
}

function suffixOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  if (dot <= slash) return ''
  return path.slice(dot)
}

function capFor(path: string): number {
  if (path === 'plugin.json') return PLUGIN_MANIFEST_MAX_BYTES
  if (path.endsWith('.html')) return PLUGIN_TEMPLATE_MAX_BYTES
  if (path.endsWith('.css')) return PLUGIN_CSS_MAX_BYTES
  return PLUGIN_FILE_MAX_BYTES
}

function assertShape(path: string) {
  if (Buffer.byteLength(path) > PLUGIN_PATH_MAX_BYTES) throw new ArchiveError(path, TOO_LONG)
  if (path.split('/').length > PLUGIN_MAX_DEPTH) throw new ArchiveError(path, TOO_DEEP)
  if (path === 'plugin.json') return
  if (!ALLOWED_SUFFIXES.has(suffixOf(path))) throw new ArchiveError(path, BAD_TYPE)
}

function readTar(tar: Buffer): ArchiveFile[] {
  if (tar.length > PLUGIN_UNCOMPRESSED_MAX_BYTES) throw new ArchiveError('(archive)', TOO_BIG)
  const files: ArchiveFile[] = []
  const seen = new Set<string>()
  let offset = 0
  let sawEnd = false
  let total = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512
    let zero = true
    for (const byte of header) {
      if (byte !== 0) {
        zero = false
        break
      }
    }
    if (zero) {
      sawEnd = true
      break
    }
    if (header.subarray(257, 262).toString('ascii') !== 'ustar') throw new ArchiveError('(archive)', UNREADABLE)
    const stored = readOctal(header, 148, 8)
    if (stored === null || stored !== headerChecksum(header)) throw new ArchiveError('(archive)', UNREADABLE)
    const size = readOctal(header, 124, 12)
    if (size === null || size < 0) throw new ArchiveError('(archive)', UNREADABLE)
    const typeflag = header[156] ?? 0
    const isFile = typeflag === 0 || typeflag === 48
    const isDir = typeflag === 53
    const name = readField(header, 0, 100)
    const prefix = readField(header, 345, 155)
    if (name.embeddedNul || prefix.embeddedNul) throw new ArchiveError('(archive)', PATH_REJECTED)
    let joined = prefix.text ? (name.text ? `${prefix.text}/${name.text}` : prefix.text) : name.text
    if (isDir) joined = joined.replace(/\/+$/, '')
    const normalised = joined ? normaliseArchivePath(joined) : null
    const pad = (512 - (size % 512)) % 512
    if (offset + size + pad > tar.length) throw new ArchiveError('(archive)', UNREADABLE)
    if (!isFile && !isDir) {
      if (!normalised) throw new ArchiveError('(archive)', PATH_REJECTED)
      throw new ArchiveError(normalised, NOT_A_FILE)
    }
    if (isDir) {
      if (joined && !normalised) throw new ArchiveError('(archive)', PATH_REJECTED)
      offset += size + pad
      continue
    }
    if (!normalised) throw new ArchiveError('(archive)', PATH_REJECTED)
    if (seen.has(normalised)) throw new ArchiveError(normalised, DUPLICATE)
    seen.add(normalised)
    assertShape(normalised)
    if (size > capFor(normalised)) throw new ArchiveError(normalised, FILE_TOO_BIG)
    if (files.length >= PLUGIN_MAX_FILES) throw new ArchiveError('(archive)', TOO_MANY)
    total += size
    if (total > PLUGIN_UNCOMPRESSED_MAX_BYTES) throw new ArchiveError('(archive)', TOO_BIG)
    files.push({ path: normalised, bytes: Buffer.from(tar.subarray(offset, offset + size)) })
    offset += size + pad
  }
  if (!sawEnd) throw new ArchiveError('(archive)', UNREADABLE)
  for (let i = offset; i < tar.length; i++) {
    if ((tar[i] ?? 0) !== 0) throw new ArchiveError('(archive)', UNREADABLE)
  }
  if (!files.some((file) => file.path === 'plugin.json')) throw new ArchiveError('plugin.json', NEED_MANIFEST)
  return files
}

/** Read a plugin .tar.gz. Throws ArchiveError. A bad path is reported as `(archive)`. */
export function readTarGz(gz: Buffer): { files: ArchiveFile[] } {
  if (!Buffer.isBuffer(gz)) throw new ArchiveError('(archive)', UNREADABLE)
  return { files: readTar(gunzipCapped(gz)) }
}

export interface RawTarEntry {
  name: Buffer
  prefix?: Buffer
  /** ustar type flag byte. `48` is a regular file (`0`). */
  typeflag: number
  data: Buffer
  mtime?: number
}

/** Write a tar without path checks. Tests use this to build hostile archives. */
export function encodeRawTar(entries: readonly RawTarEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    entry.name.copy(header, 0, 0, Math.min(entry.name.length, 100))
    if (entry.prefix?.length) entry.prefix.copy(header, 345, 0, Math.min(entry.prefix.length, 155))
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, entry.data.length)
    writeOctal(header, 136, 12, entry.mtime ?? 0)
    header[156] = entry.typeflag
    header.write('ustar', 257, 'ascii')
    header.write('00', 263, 'ascii')
    writeChecksum(header)
    chunks.push(header, entry.data)
    const pad = (512 - (entry.data.length % 512)) % 512
    if (pad) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function splitUstar(path: string): { name: Buffer; prefix?: Buffer } {
  if (Buffer.byteLength(path) <= 100) return { name: Buffer.from(path) }
  const slash = path.lastIndexOf('/')
  if (slash <= 0) throw new ArchiveError(path, TOO_LONG)
  const prefix = path.slice(0, slash)
  const name = path.slice(slash + 1)
  if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) throw new ArchiveError(path, TOO_LONG)
  return { name: Buffer.from(name), prefix: Buffer.from(prefix) }
}

export function writeTar(files: readonly ArchiveFile[], opts?: { mtime?: number }): Buffer {
  if (files.length > PLUGIN_MAX_FILES) throw new ArchiveError('(archive)', TOO_MANY)
  const seen = new Set<string>()
  let total = 0
  const entries: RawTarEntry[] = []
  for (const file of files) {
    const path = normaliseArchivePath(file.path)
    if (!path || path !== file.path.normalize('NFC')) throw new ArchiveError('(archive)', PATH_REJECTED)
    if (seen.has(path)) throw new ArchiveError(path, DUPLICATE)
    seen.add(path)
    assertShape(path)
    if (file.bytes.length > capFor(path)) throw new ArchiveError(path, FILE_TOO_BIG)
    total += file.bytes.length
    if (total > PLUGIN_UNCOMPRESSED_MAX_BYTES) throw new ArchiveError('(archive)', TOO_BIG)
    const split = splitUstar(path)
    entries.push({ name: split.name, prefix: split.prefix, typeflag: 48, data: file.bytes, mtime: opts?.mtime ?? 0 })
  }
  return encodeRawTar(entries)
}

/** Gzip mtime is 0 so two packs of the same files match. The content hash does not cover these bytes. */
export function writeTarGz(files: readonly ArchiveFile[], opts?: { mtime?: number }): Buffer {
  // Node accepts mtime here. The published types omit it, so set it after the options object exists.
  const options = Object.assign({} as ZlibOptions, { mtime: 0 })
  return gzipSync(writeTar(files, opts), options)
}
