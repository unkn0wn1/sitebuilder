// A small props and settings schema, turned into a strict Zod object.
// This is not a general JSON Schema interpreter.
import { z } from 'zod'
import { imageRef, linkRef } from '../blocks/define'
import type { FieldIssue } from '../issues'
import { richTextDoc } from '../richtext'

const BANNED = new Set(['$ref', 'oneOf', 'allOf', 'not', 'pattern', 'format', 'additionalProperties'])
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'link' | 'image' | 'richtext' | 'list' | 'object'

export interface CompiledField {
  name: string
  type: FieldType
  children?: CompiledField[]
}

export interface SettingsField {
  key: string
  schema: z.ZodType
  hasDefault: boolean
  defaultValue?: unknown
}

export interface CompiledSchema {
  issues: FieldIssue[]
  schema: z.ZodType | null
  fields: CompiledField[]
  names: Set<string>
  imagePaths: Set<string>
  settingsFields: SettingsField[]
}

interface CompileOpts {
  path: string
  mode: 'block' | 'settings'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

const ALLOWED: Record<string, string[]> = {
  string: ['type', 'max', 'min', 'required', 'default'],
  number: ['type', 'min', 'max', 'integer', 'required', 'default'],
  boolean: ['type', 'required', 'default'],
  enum: ['type', 'options', 'required', 'default'],
  link: ['type', 'required'],
  image: ['type', 'required'],
  richtext: ['type', 'required'],
  list: ['type', 'max', 'item', 'required'],
  object: ['type', 'fields', 'required'],
}

function unknownKeys(node: Record<string, unknown>, allowed: string[], path: string): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const key of Object.keys(node)) {
    if (BANNED.has(key) || !allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: 'This schema feature is not allowed.' })
    }
  }
  return issues
}

function requiredFlag(node: Record<string, unknown>, path: string, issues: FieldIssue[]): boolean | null {
  if (!('required' in node)) return false
  if (node.required === true) return true
  if (node.required === false) return false
  issues.push({ path: `${path}.required`, message: 'Say whether this field is required.' })
  return null
}

function wrap(schema: z.ZodType, required: boolean): z.ZodType {
  return required ? schema : schema.optional()
}

interface Walk {
  issues: FieldIssue[]
  names: Set<string>
  imagePaths: Set<string>
  count: number
  max: number
  mode: 'block' | 'settings'
  /** Top-level settings fields, filled only for the root object. */
  settingsFields: SettingsField[]
  collectSettings: boolean
}

function compileField(node: unknown, path: string, depth: number, prefix: string, name: string, scalarOnly: boolean, walk: Walk): { schema: z.ZodType; field: CompiledField } | null {
  if (!isRecord(node)) {
    walk.issues.push({ path, message: 'This field needs a type.' })
    return null
  }
  const type = node.type
  if (typeof type !== 'string' || !(type in ALLOWED)) {
    const banned = Object.keys(node).filter((key) => BANNED.has(key))
    if (banned.length) {
      for (const key of banned) walk.issues.push({ path: `${path}.${key}`, message: 'This schema feature is not allowed.' })
      return null
    }
    walk.issues.push({ path, message: 'This field type is not allowed.' })
    return null
  }
  const allowed = ALLOWED[type] ?? []
  const keys = unknownKeys(node, walk.mode === 'settings' ? allowed : allowed.filter((key) => key !== 'default'), path)
  if (keys.length) {
    walk.issues.push(...keys)
    return null
  }
  if (walk.mode === 'settings' && type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'enum') {
    walk.issues.push({ path, message: 'Settings only allow text, numbers, yes or no, and choices.' })
    return null
  }
  if (scalarOnly && (type === 'object' || type === 'list')) {
    walk.issues.push({ path, message: 'A list item cannot contain another list or group.' })
    return null
  }
  const required = requiredFlag(node, path, walk.issues)
  if (required === null) return null

  if (type === 'string') {
    const max = intIn(node.max, 1, 5000)
    if (max === null) {
      walk.issues.push({ path: `${path}.max`, message: 'Say how long this text can be (1 to 5000 characters).' })
      return null
    }
    const min = node.min === undefined ? 0 : intIn(node.min, 0, max)
    if (min === null) {
      walk.issues.push({ path: `${path}.min`, message: 'The shortest length is not valid.' })
      return null
    }
    const minLen = required ? Math.max(min, 1) : min
    let schema: z.ZodType = z.string()
    if (minLen > 0) schema = (schema as z.ZodString).min(minLen, { message: minLen === 1 && required ? 'This is needed.' : `Use at least ${minLen} characters.` })
    schema = (schema as z.ZodString).max(max, { message: `Keep this under ${max} characters.` })
    const built = rememberDefault(node, path, schema, required, walk, name)
    return built ? { schema: built, field: { name, type: 'string' } } : null
  }

  if (type === 'number') {
    if (node.integer !== undefined && typeof node.integer !== 'boolean') {
      walk.issues.push({ path: `${path}.integer`, message: 'Say whether this is a whole number.' })
      return null
    }
    const integer = node.integer === true
    const min = node.min === undefined ? null : node.min
    const max = node.max === undefined ? null : node.max
    if (min !== null && (typeof min !== 'number' || !Number.isFinite(min))) {
      walk.issues.push({ path: `${path}.min`, message: 'The smallest number is not valid.' })
      return null
    }
    if (max !== null && (typeof max !== 'number' || !Number.isFinite(max))) {
      walk.issues.push({ path: `${path}.max`, message: 'The largest number is not valid.' })
      return null
    }
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      walk.issues.push({ path, message: 'The smallest number is above the largest.' })
      return null
    }
    let schema: z.ZodType = integer ? z.number().int({ message: 'Use a whole number.' }) : z.number({ message: 'Use a number.' })
    if (typeof min === 'number') schema = (schema as z.ZodNumber).min(min, { message: `Use at least ${min}.` })
    if (typeof max === 'number') schema = (schema as z.ZodNumber).max(max, { message: `Keep this at or under ${max}.` })
    const built = rememberDefault(node, path, schema, required, walk, name)
    return built ? { schema: built, field: { name, type: 'number' } } : null
  }

  if (type === 'boolean') {
    const built = rememberDefault(node, path, z.boolean({ message: 'Choose yes or no.' }), required, walk, name)
    return built ? { schema: built, field: { name, type: 'boolean' } } : null
  }

  if (type === 'enum') {
    const options = node.options
    if (!Array.isArray(options) || options.length < 1 || options.length > 12) {
      walk.issues.push({ path: `${path}.options`, message: 'List between 1 and 12 choices.' })
      return null
    }
    const values: string[] = []
    for (const option of options) {
      if (typeof option !== 'string' || option.length < 1 || option.length > 40 || values.includes(option)) {
        walk.issues.push({ path: `${path}.options`, message: 'Each choice must be a short unique label.' })
        return null
      }
      values.push(option)
    }
    const tuple = values as [string, ...string[]]
    const built = rememberDefault(node, path, z.enum(tuple, { message: 'Choose one of the listed values.' }), required, walk, name)
    return built ? { schema: built, field: { name, type: 'enum' } } : null
  }

  if (type === 'link' || type === 'image' || type === 'richtext') {
    const schema = type === 'link' ? linkRef : type === 'image' ? imageRef : richTextDoc
    if (type === 'image') walk.imagePaths.add(prefix ? `${prefix}.${name}` : name)
    return { schema: wrap(schema, required), field: { name, type } }
  }

  if (type === 'list') {
    if (depth >= 4) {
      walk.issues.push({ path, message: 'This schema is nested too deeply.' })
      return null
    }
    const max = intIn(node.max, 1, 20)
    if (max === null) {
      walk.issues.push({ path: `${path}.max`, message: 'Say how many items are allowed (1 to 20).' })
      return null
    }
    const item = compileObject(node.item, `${path}.item`, depth + 1, prefix ? `${prefix}.${name}` : name, true, walk)
    if (!item) return null
    const schema = wrap(z.array(item.schema).max(max, { message: `Use at most ${max} items.` }), required)
    return { schema, field: { name, type: 'list', children: item.fields } }
  }

  if (depth >= 4) {
    walk.issues.push({ path, message: 'This schema is nested too deeply.' })
    return null
  }
  const child = compileObject(node, path, depth + 1, prefix ? `${prefix}.${name}` : name, scalarOnly, walk)
  if (!child) return null
  return { schema: wrap(child.schema, required), field: { name, type: 'object', children: child.fields } }
}

function rememberDefault(node: Record<string, unknown>, path: string, schema: z.ZodType, required: boolean, walk: Walk, name: string): z.ZodType | null {
  let hasDefault = false
  let defaultValue: unknown
  if ('default' in node) {
    if (walk.mode !== 'settings') {
      walk.issues.push({ path: `${path}.default`, message: 'This schema feature is not allowed.' })
      return null
    }
    const parsed = schema.safeParse(node.default)
    if (!parsed.success) {
      walk.issues.push({ path: `${path}.default`, message: 'The default does not match this field.' })
      return null
    }
    hasDefault = true
    defaultValue = parsed.data
  }
  const wrapped = wrap(schema, required)
  if (walk.collectSettings) walk.settingsFields.push({ key: name, schema, hasDefault, defaultValue })
  return wrapped
}

function compileObject(node: unknown, path: string, depth: number, prefix: string, scalarOnly: boolean, walk: Walk): { schema: z.ZodType; fields: CompiledField[] } | null {
  if (depth > 4) {
    walk.issues.push({ path, message: 'This schema is nested too deeply.' })
    return null
  }
  if (!isRecord(node)) {
    walk.issues.push({ path, message: 'This needs to be an object.' })
    return null
  }
  const banned = Object.keys(node).filter((key) => BANNED.has(key))
  if (banned.length) {
    for (const key of banned) walk.issues.push({ path: `${path}.${key}`, message: 'This schema feature is not allowed.' })
    return null
  }
  if (node.type !== 'object') {
    walk.issues.push({ path, message: 'This needs to be an object.' })
    return null
  }
  const extra = unknownKeys(node, ['type', 'fields', 'required'], path)
  if (extra.length) {
    walk.issues.push(...extra)
    return null
  }
  if (!isRecord(node.fields)) {
    walk.issues.push({ path: `${path}.fields`, message: 'Add the fields for this object.' })
    return null
  }
  const shape: Record<string, z.ZodType> = {}
  const fields: CompiledField[] = []
  const collectHere = walk.collectSettings
  if (depth !== 1) walk.collectSettings = false
  for (const key of Object.keys(node.fields)) {
    const fieldPath = `${path}.fields.${key}`
    if (!FIELD_NAME.test(key)) {
      walk.issues.push({ path: fieldPath, message: 'Use a plain name for this field.' })
      continue
    }
    if (walk.names.has(key) && depth === 1) {
      // The same name in two nested places is allowed. A repeated top-level key cannot happen on a plain object.
    }
    walk.names.add(key)
    if (walk.count >= walk.max) {
      walk.issues.push({ path: fieldPath, message: 'There are too many fields.' })
      break
    }
    walk.count++
    const compiled = compileField(node.fields[key], fieldPath, depth, prefix, key, scalarOnly, walk)
    if (!compiled) continue
    shape[key] = compiled.schema
    fields.push(compiled.field)
  }
  walk.collectSettings = collectHere
  if (walk.issues.length) return { schema: z.strictObject(shape), fields }
  return { schema: z.strictObject(shape), fields }
}

export function compileObjectSchema(raw: unknown, opts: CompileOpts): CompiledSchema {
  const walk: Walk = {
    issues: [],
    names: new Set(),
    imagePaths: new Set(),
    count: 0,
    max: opts.mode === 'settings' ? 20 : 40,
    mode: opts.mode,
    settingsFields: [],
    collectSettings: opts.mode === 'settings',
  }
  const compiled = compileObject(raw, opts.path, 1, '', false, walk)
  return {
    issues: walk.issues,
    schema: walk.issues.length ? null : (compiled?.schema ?? null),
    fields: compiled?.fields ?? [],
    names: walk.names,
    imagePaths: walk.imagePaths,
    settingsFields: walk.settingsFields,
  }
}

/** String or number prop, not through a list. Null when the path is not that. */
export function resolveScalarProp(fields: readonly CompiledField[], path: string): 'string' | 'number' | null {
  const parts = path.split('.')
  let level: readonly CompiledField[] = fields
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part || !/^[A-Za-z][A-Za-z0-9]*$/.test(part)) return null
    const next = level.find((field) => field.name === part)
    if (!next) return null
    const last = i === parts.length - 1
    if (last) return next.type === 'string' || next.type === 'number' ? next.type : null
    if (next.type !== 'object' || !next.children) return null
    level = next.children
  }
  return null
}
