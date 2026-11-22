import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ArchiveError, encodeRawTar, readTarGz, writeTarGz, type RawTarEntry } from '../shared/plugins/archive'
import { PLUGIN_ARCHIVE_MAX_BYTES, PLUGIN_FILE_MAX_BYTES, PLUGIN_MAX_FILES } from '../shared/plugins/limits'

function raw(entries: RawTarEntry[]): Buffer {
  return gzipSync(encodeRawTar(entries))
}

function readError(buf: Buffer): ArchiveError {
  try {
    readTarGz(buf)
  } catch (error) {
    if (error instanceof ArchiveError) return error
    throw error
  }
  throw new Error('expected an archive error')
}

describe('plugin archives', () => {
  it('round-trips a package', () => {
    const archive = writeTarGz([
      { path: 'plugin.json', bytes: Buffer.from('{}') },
      { path: 'note.html', bytes: Buffer.from('<section>Hello</section>') },
    ])
    const names = readTarGz(archive).files.map((file) => file.path).sort()
    expect(names).toEqual(['note.html', 'plugin.json'])
  })

  it('rejects hostile paths without echoing them', () => {
    const names = [Buffer.from('../x'), Buffer.from('/x.html'), Buffer.from('a\\b.html'), Buffer.from('a\0b.html')]
    for (const name of names) {
      const error = readError(raw([{ name, typeflag: 48, data: Buffer.from('x') }]))
      expect(error.path).toBe('(archive)')
      expect(error.message).toBe('A file path in the archive is not allowed.')
      expect(error.message.includes('..')).toBe(false)
      expect(error.message.includes('\\')).toBe(false)
      expect(error.path.includes('\0')).toBe(false)
    }
  })

  it('rejects a symlink, a duplicate name and a bad suffix', () => {
    const link = readError(raw([{ name: Buffer.from('link.html'), typeflag: 50, data: Buffer.alloc(0) }]))
    expect(link.path).toBe('link.html')
    expect(link.message).toBe('This archive entry is not a regular file.')

    const twice = readError(raw([
      { name: Buffer.from('a.html'), typeflag: 48, data: Buffer.from('1') },
      { name: Buffer.from('a.html'), typeflag: 48, data: Buffer.from('2') },
    ]))
    expect(twice.path).toBe('a.html')
    expect(twice.message).toBe('This file is listed twice.')

    const suffix = readError(raw([{ name: Buffer.from('readme.txt'), typeflag: 48, data: Buffer.from('hi') }]))
    expect(suffix.path).toBe('readme.txt')
    expect(suffix.message).toBe('This file type is not allowed.')
  })

  it('rejects an oversize member, too many files and a gzip bomb', () => {
    const big = readError(raw([{ name: Buffer.from('big.png'), typeflag: 48, data: Buffer.alloc(PLUGIN_FILE_MAX_BYTES + 1) }]))
    expect(big.path).toBe('big.png')
    expect(big.message).toBe('This file is over the size limit.')

    const many = Array.from({ length: PLUGIN_MAX_FILES + 1 }, (_, index) => ({
      name: Buffer.from(`f${index}.html`),
      typeflag: 48,
      data: Buffer.from('a'),
    }))
    const crowded = readError(raw(many))
    expect(crowded.path).toBe('(archive)')
    expect(crowded.message).toBe('The archive has too many files.')

    const bomb = Array.from({ length: 10 }, (_, index) => ({
      name: Buffer.from(`f${index}.png`),
      typeflag: 48,
      data: Buffer.alloc(256 * 1024),
    }))
    const expanded = readError(gzipSync(encodeRawTar(bomb)))
    expect(expanded.path).toBe('(archive)')
    expect(expanded.message).toBe('The archive is over the size limit.')
  })

  it('rejects an unreadable archive, a huge buffer and a package with no manifest', () => {
    expect(readError(Buffer.from('not gzip')).message).toBe('The archive could not be read.')
    const huge = Buffer.alloc(PLUGIN_ARCHIVE_MAX_BYTES + 1)
    expect(readError(huge).message).toBe('The archive is over the size limit.')
    const missing = readError(writeTarGz([{ path: 'note.html', bytes: Buffer.from('<p>Hi</p>') }]))
    expect(missing.path).toBe('plugin.json')
    expect(missing.message).toBe('The archive must include plugin.json.')
  })

  it('accepts 32 files', () => {
    const files = [{ path: 'plugin.json', bytes: Buffer.from('{}') }]
    for (let index = 0; index < PLUGIN_MAX_FILES - 1; index++) files.push({ path: `n${index}.html`, bytes: Buffer.from('a') })
    expect(readTarGz(writeTarGz(files)).files).toHaveLength(PLUGIN_MAX_FILES)
  })
})
