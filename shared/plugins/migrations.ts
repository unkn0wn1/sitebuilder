// Declarative plugin migrations. The interpreter only. Templates do not run here.
import type { PropsMigration } from '../blocks/define'
import type { FieldIssue } from '../issues'

const NAME = /^[A-Za-z][A-Za-z0-9]*$/
const RESERVED = new Set(['constructor', 'prototype'])

export type MigrationMap = Record<string, string | string[]>

function validName(name: string): boolean {
  return NAME.test(name) && !RESERVED.has(name)
}

function validOp(op: string): boolean {
  if (op.length === 0 || op.length > 500) return false
  const rename = /^rename:([A-Za-z][A-Za-z0-9]*)->([A-Za-z][A-Za-z0-9]*)$/.exec(op)
  if (rename) return !!rename[1] && !!rename[2] && validName(rename[1]) && validName(rename[2])
  const del = /^delete:([A-Za-z][A-Za-z0-9]*)$/.exec(op)
  if (del?.[1]) return validName(del[1])
  const set = /^set:([A-Za-z][A-Za-z0-9]*)=([\s\S]*)$/.exec(op)
  if (!set?.[1] || set[2] === undefined || !validName(set[1])) return false
  try {
    JSON.parse(set[2])
    return true
  } catch {
    return false
  }
}

/** Gap, unknown step, or a step that is not rename, delete or set. */
export function migrationStepIssues(version: number, raw: MigrationMap | undefined, path: string): FieldIssue[] {
  const issues: FieldIssue[] = []
  const steps = raw ?? {}
  const expected = new Set<string>()
  for (let from = 1; from < version; from++) expected.add(`${from}->${from + 1}`)
  for (const key of expected) {
    if (!(key in steps)) {
      issues.push({ path, message: 'The migrations skip a version.' })
      break
    }
  }
  for (const key of Object.keys(steps)) {
    if (!expected.has(key)) {
      issues.push({ path: `${path}.${key}`, message: 'This migration is not for a version this block uses.' })
      continue
    }
    const value = steps[key]
    const ops = Array.isArray(value) ? value : [value]
    if (!Array.isArray(value) && typeof value !== 'string') {
      issues.push({ path: `${path}.${key}`, message: 'This migration step is not valid.' })
      continue
    }
    if (ops.length > 20) {
      issues.push({ path: `${path}.${key}`, message: 'This migration has too many steps.' })
      continue
    }
    ops.forEach((op, index) => {
      if (typeof op !== 'string' || !validOp(op)) {
        issues.push({ path: `${path}.${key}.${index}`, message: 'This migration step is not valid.' })
      }
    })
  }
  return issues
}

export function applyOps(props: Record<string, unknown>, ops: readonly string[]): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props }
  for (const op of ops) {
    const rename = /^rename:([A-Za-z][A-Za-z0-9]*)->([A-Za-z][A-Za-z0-9]*)$/.exec(op)
    if (rename?.[1] && rename[2]) {
      if (Object.prototype.hasOwnProperty.call(next, rename[1])) {
        next[rename[2]] = next[rename[1]]
        delete next[rename[1]]
      }
      continue
    }
    const del = /^delete:([A-Za-z][A-Za-z0-9]*)$/.exec(op)
    if (del?.[1]) {
      delete next[del[1]]
      continue
    }
    const set = /^set:([A-Za-z][A-Za-z0-9]*)=([\s\S]*)$/.exec(op)
    if (set?.[1] && set[2] !== undefined) next[set[1]] = JSON.parse(set[2]) as unknown
  }
  return next
}

/** migrations[from] upgrades props from `from` to `from + 1`, which is what the registry already calls. */
export function compileMigrations(version: number, raw: MigrationMap | undefined): Record<number, PropsMigration> {
  const out: Record<number, PropsMigration> = {}
  for (let from = 1; from < version; from++) {
    const key = `${from}->${from + 1}`
    const value = raw?.[key]
    if (value === undefined) throw new Error('The migrations skip a version.')
    const ops = (Array.isArray(value) ? value : [value]).filter((op): op is string => typeof op === 'string')
    out[from] = (props) => applyOps(props, ops)
  }
  return out
}
