import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readTarGz, writeTar, writeTarGz } from '../shared/plugins/archive'
import { contentHash } from '../shared/plugins/hash'

const files = [
  { path: 'plugin.json', bytes: Buffer.from('{"id":"hello-note"}') },
  { path: 'note.html', bytes: Buffer.from('<section>Hello</section>') },
]

describe('plugin content hash', () => {
  it('is stable across order, ustar mtime and gzip headers', () => {
    const forward = contentHash(files)
    const backward = contentHash([...files].reverse())
    expect(forward.hex).toBe(backward.hex)
    expect(forward.hex).toMatch(/^[0-9a-f]{64}$/)
    expect(forward.raw).toHaveLength(32)

    const early = contentHash(readTarGz(gzipSync(writeTar(files, { mtime: 0 }))).files)
    const late = contentHash(readTarGz(gzipSync(writeTar(files, { mtime: 1700000000 }))).files)
    expect(early.hex).toBe(forward.hex)
    expect(late.hex).toBe(forward.hex)

    const tar = writeTar(files, { mtime: 0 })
    const gzEarlyBuf = gzipSync(tar)
    const gzLateBuf = Buffer.from(gzEarlyBuf)
    gzLateBuf[4] = (gzLateBuf[4] ?? 0) ^ 0xff
    expect(gzEarlyBuf.equals(gzLateBuf)).toBe(false)
    const gzEarly = contentHash(readTarGz(gzEarlyBuf).files)
    const gzLate = contentHash(readTarGz(gzLateBuf).files)
    expect(gzEarly.hex).toBe(gzLate.hex)
    expect(writeTarGz(files).length).toBeGreaterThan(10)
  })

  it('changes when one byte changes or a file is added', () => {
    const base = contentHash(files).hex
    const first = files[0]
    const note = files[1]
    if (!first || !note) throw new Error('missing file')
    const bytes = Buffer.from(note.bytes)
    bytes[0] = bytes[0] === 60 ? 61 : 60
    const flipped = [first, { path: note.path, bytes }]
    expect(contentHash(flipped).hex).not.toBe(base)
    const extra = [...files, { path: 'extra.html', bytes: Buffer.from('x') }]
    expect(contentHash(extra).hex).not.toBe(base)
  })
})
