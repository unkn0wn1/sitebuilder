import { execFileSync } from 'node:child_process'
import { linkSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { writeNew } from '../server/services/release'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('writeNew', () => {
  it('keeps the old bytes on a hard link and leaves no temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-write-new-'))
    const a = join(dir, 'a.txt')
    const b = join(dir, 'b.txt')
    writeFileSync(a, 'old')
    linkSync(a, b)
    const oldInode = statSync(b).ino

    writeNew(a, 'new')

    expect(readFileSync(a, 'utf8')).toBe('new')
    expect(readFileSync(b, 'utf8')).toBe('old')
    expect(statSync(b).ino).toBe(oldInode)
    expect(statSync(a).ino).not.toBe(oldInode)
    expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt'])
  })
})

describe('nginx entrypoint', () => {
  it('passes sh -n', () => {
    execFileSync('sh', ['-n', join(root, 'deploy/nginx-entrypoint.sh')], { stdio: 'pipe' })
  })
})
