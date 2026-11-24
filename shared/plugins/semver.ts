// Plugin versions and the core range check. No semver package.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Semver {
  major: number
  minor: number
  patch: number
}

function readCoreVersion(): string {
  const candidates = [new URL('../../package.json', import.meta.url), join(process.cwd(), 'package.json')]
  for (const candidate of candidates) {
    try {
      const text = readFileSync(candidate, 'utf8')
      const version = JSON.parse(text).version
      if (typeof version === 'string' && parseSemver(version)) return version
    } catch {
      // A bundled copy of this file may not sit next to package.json. Try the next path.
    }
  }
  throw new Error('Could not read the sitebuilder version from package.json.')
}

/** package.json version, read once. Not a git tag. */
export const CORE_VERSION = readCoreVersion()

/** MAJOR.MINOR.PATCH with no pre-release and no leading zeros. */
export function parseSemver(input: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(input)
  if (!match) return null
  const parts = [match[1], match[2], match[3]]
  if (parts.some((part) => part === undefined || (part.length > 1 && part.startsWith('0')))) return null
  const [major, minor, patch] = parts.map((part) => Number(part))
  if (major === undefined || minor === undefined || patch === undefined) return null
  if (![major, minor, patch].every((part) => Number.isSafeInteger(part))) return null
  return { major, minor, patch }
}

/** -1 when a is older, 0 when equal, 1 when a is newer. Null when either side is not a version. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major > right.major ? 1 : -1
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1
  return 0
}

function holds(op: string, core: Semver, want: Semver): boolean {
  const cmp = compareSemver(`${core.major}.${core.minor}.${core.patch}`, `${want.major}.${want.minor}.${want.patch}`)
  if (cmp === null) return false
  if (op === '=') return cmp === 0
  if (op === '>') return cmp > 0
  if (op === '>=') return cmp >= 0
  if (op === '<') return cmp < 0
  if (op === '<=') return cmp <= 0
  return false
}

/**
 * Every comparator must hold. Comparators are separated by one space.
 * Each one is `>=`, `>`, `<=`, `<` or `=` plus MAJOR.MINOR.PATCH.
 */
export function satisfiesCore(range: string, version: string = CORE_VERSION): boolean {
  if (!/^((>=|>|<=|<|=)\d+\.\d+\.\d+)( (>=|>|<=|<|=)\d+\.\d+\.\d+)*$/.test(range)) return false
  const core = parseSemver(version)
  if (!core) return false
  for (const part of range.split(' ')) {
    const match = /^(>=|>|<=|<|=)(\d+\.\d+\.\d+)$/.exec(part)
    if (!match?.[1] || !match[2]) return false
    const want = parseSemver(match[2])
    if (!want || !holds(match[1], core, want)) return false
  }
  return true
}
