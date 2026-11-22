// Plugin manifest. Strict objects, plain errors, no echo of the rejected value.
import { z } from 'zod'
import type { BlockDefinition } from '../blocks/define'
import { defineBlock } from '../blocks/define'
import type { FieldIssue } from '../issues'
import { PLUGIN_DESCRIBE_MAX, PLUGIN_MAX_BLOCKS } from './limits'
import { compileMigrations, migrationStepIssues, type MigrationMap } from './migrations'
import { compileObjectSchema, resolveScalarProp, type CompiledField } from './schema-subset'
import { parseSemver, satisfiesCore } from './semver'

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/
const BLOCK_TYPE_RE = /^[A-Z][A-Za-z0-9]{0,23}$/
const CATEGORIES = ['Headers', 'Text', 'Media', 'Calls to action', 'Embeds', 'Lists'] as const
const PERMISSIONS = ['blocks', 'head', 'settings'] as const
const CSP_DIRS = ['img', 'frame', 'script', 'connect', 'font'] as const
const COMPUTED_NAME = /^[a-z][a-zA-Z0-9]{0,31}$/
const SETTINGS_REF = /^\{\{settings\.([a-z][a-zA-Z0-9]{0,31})\}\}$/
const NUMERIC_OPS = new Set(['percent', 'svg-scale', 'money', 'add', 'subtract', 'min'])

export type PluginCategory = (typeof CATEGORIES)[number]
export type PluginPermission = (typeof PERMISSIONS)[number]
export type ComputedOp = 'percent' | 'svg-scale' | 'money' | 'add' | 'subtract' | 'min' | 'match-fill'

export interface ComputedField {
  name: string
  op: ComputedOp
  args: (string | number)[]
}

export interface PluginBlock {
  type: string
  v: number
  label: string
  category: PluginCategory
  props: Record<string, unknown>
  template: string
  css?: string
  example: Record<string, unknown>
  computed: ComputedField[]
  agent: { writable: boolean; describe: string }
  agentNever: string[]
  money: boolean
  imageSlots?: Record<string, { width: number; height: number }>
}

export interface PluginHeadMeta {
  tag: 'meta'
  name?: string
  property?: string
  content: string
}

export interface PluginHeadLink {
  tag: 'link'
  rel: 'preconnect' | 'alternate'
  href: string
}

export type PluginHead = PluginHeadMeta | PluginHeadLink

export interface PluginOrigin {
  directive: 'img' | 'frame' | 'connect' | 'font' | 'head'
  origin: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  sitebuilder: string
  permissions: PluginPermission[]
  csp: { img: string[]; frame: string[]; script: string[]; connect: string[]; font: string[] }
  blocks: PluginBlock[]
  head: PluginHead[]
  settings?: Record<string, unknown>
  migrations?: Record<string, MigrationMap>
}

export interface ParsedManifest {
  manifest: PluginManifest
  origins: PluginOrigin[]
}

const TOP_KEYS = ['id', 'name', 'version', 'sitebuilder', 'permissions', 'csp', 'blocks', 'head', 'settings', 'migrations']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOrigin(value: string): string | null {
  if (value.length > 200 || value.includes('*') || value.includes('\\') || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  if (value !== url.origin) return null
  return url.origin
}

function isSitePath(href: string): boolean {
  return href.length >= 1 && href.length <= 200 && /^\/[A-Za-z0-9._~%+/-]*$/.test(href) && !href.includes('//')
}

function relativeFile(value: unknown, suffix: string): string | null {
  if (typeof value !== 'string') return null
  const path = value.normalize('NFC')
  if (path !== value || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  if (parts.length > 4 || Buffer.byteLength(path) > 120) return null
  if (!path.endsWith(suffix)) return null
  return path
}

function fileReady(files: ReadonlyMap<string, Buffer> | null, path: string, issuePath: string, empty: string, issues: FieldIssue[]) {
  if (!files) return
  const bytes = files.get(path)
  if (!bytes) issues.push({ path: issuePath, message: 'This file is not in the archive.' })
  else if (bytes.length === 0) issues.push({ path: issuePath, message: empty })
}

function readCsp(raw: unknown, issues: FieldIssue[]): PluginManifest['csp'] | null {
  if (!isRecord(raw)) {
    issues.push({ path: 'csp', message: 'List the addresses this plugin needs, or leave each list empty.' })
    return null
  }
  for (const key of Object.keys(raw)) {
    if (!CSP_DIRS.includes(key as (typeof CSP_DIRS)[number])) issues.push({ path: `csp.${key}`, message: 'This field is not allowed.' })
  }
  const out = { img: [] as string[], frame: [] as string[], script: [] as string[], connect: [] as string[], font: [] as string[] }
  let ok = true
  for (const dir of CSP_DIRS) {
    if (!(dir in raw)) {
      issues.push({ path: `csp.${dir}`, message: 'This list is needed. Use an empty list when there are no addresses.' })
      ok = false
      continue
    }
    const value = raw[dir]
    if (!Array.isArray(value)) {
      issues.push({ path: `csp.${dir}`, message: 'This needs to be a list.' })
      ok = false
      continue
    }
    if (dir === 'script') {
      if (value.length > 0) issues.push({ path: 'csp.script', message: 'This plugin asks to load scripts. Version 1 plugins cannot add scripts.' })
      continue
    }
    value.forEach((entry, index) => {
      if (typeof entry !== 'string' || !parseOrigin(entry)) {
        issues.push({ path: `csp.${dir}.${index}`, message: 'Use an https address with a host and no path.' })
        ok = false
        return
      }
      out[dir].push(entry)
    })
  }
  return ok ? out : null
}

function checkComputed(raw: unknown, path: string, fields: CompiledField[], issues: FieldIssue[]): ComputedField[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 16) {
    issues.push({ path, message: 'Computed fields must be a short list.' })
    return []
  }
  const top = new Set(fields.map((field) => field.name))
  const parsed: ComputedField[] = []
  const names = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    const itemPath = `${path}.${i}`
    if (!isRecord(item)) {
      issues.push({ path: itemPath, message: 'This computed field is not valid.' })
      continue
    }
    for (const key of Object.keys(item)) {
      if (key !== 'name' && key !== 'op' && key !== 'args') issues.push({ path: `${itemPath}.${key}`, message: 'This field is not allowed.' })
    }
    const name = item.name
    const op = item.op
    if (typeof name !== 'string' || !COMPUTED_NAME.test(name) || top.has(name) || names.has(name)) {
      issues.push({ path: `${itemPath}.name`, message: 'Use a short name that is not already a prop.' })
      continue
    }
    names.add(name)
    if (op !== 'percent' && op !== 'svg-scale' && op !== 'money' && op !== 'add' && op !== 'subtract' && op !== 'min' && op !== 'match-fill') {
      issues.push({ path: `${itemPath}.op`, message: 'This computed operation is not allowed.' })
      continue
    }
    if (!Array.isArray(item.args)) {
      issues.push({ path: `${itemPath}.args`, message: 'This computed field has the wrong inputs.' })
      continue
    }
    const args = item.args
    if (!argsLookValid(op, args, fields, names, parsed)) {
      issues.push({ path: `${itemPath}.args`, message: 'This computed field has the wrong inputs.' })
      continue
    }
    parsed.push({ name, op, args: args as (string | number)[] })
  }
  if (hasCycle(parsed)) issues.push({ path, message: 'These computed fields refer to each other.' })
  return parsed
}

function argsLookValid(op: ComputedOp, args: unknown[], fields: CompiledField[], earlier: Set<string>, parsed: ComputedField[]): boolean {
  const numeric = (value: unknown): boolean => {
    if (typeof value === 'number') return Number.isInteger(value) && Number.isSafeInteger(value)
    if (typeof value !== 'string') return false
    if (earlier.has(value)) {
      const prior = parsed.find((field) => field.name === value)
      return !!prior && prior.op !== 'match-fill'
    }
    const kind = resolveScalarProp(fields, value)
    return kind === 'string' || kind === 'number'
  }
  const literal = (value: unknown, min: number, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
  if (op === 'percent' || op === 'add' || op === 'subtract' || op === 'min') return args.length === 2 && args.every(numeric)
  if (op === 'money') {
    if (args.length === 1) return numeric(args[0])
    if (args.length !== 2 || !numeric(args[0])) return false
    return typeof args[1] === 'string' && resolveScalarProp(fields, args[1]) === 'string'
  }
  if (op === 'svg-scale') return args.length === 3 && numeric(args[0]) && numeric(args[1]) && literal(args[2], 1, 2000)
  if (op === 'match-fill') {
    return args.length === 5 && numeric(args[0]) && numeric(args[1]) && numeric(args[2]) && literal(args[3], 0, 20000) && literal(args[4], 0, 20000)
  }
  return false
}

function hasCycle(fields: ComputedField[]): boolean {
  const deps = new Map<string, string[]>()
  const names = new Set(fields.map((field) => field.name))
  for (const field of fields) {
    deps.set(
      field.name,
      field.args.filter((arg): arg is string => typeof arg === 'string' && names.has(arg)),
    )
  }
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (name: string): boolean => {
    const mark = state.get(name) ?? 0
    if (mark === 1) return true
    if (mark === 2) return false
    state.set(name, 1)
    for (const dep of deps.get(name) ?? []) {
      if (visit(dep)) return true
    }
    state.set(name, 2)
    return false
  }
  return fields.some((field) => visit(field.name))
}

function readBlock(raw: unknown, index: number, id: string, files: ReadonlyMap<string, Buffer> | null, stringSettings: Set<string>, issues: FieldIssue[]): PluginBlock | null {
  const path = `blocks.${index}`
  if (!isRecord(raw)) {
    issues.push({ path, message: 'This block is not valid.' })
    return null
  }
  const allowed = ['type', 'v', 'label', 'category', 'props', 'template', 'css', 'example', 'computed', 'agent', 'agentNever', 'money', 'imageSlots']
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}.${key}`, message: 'This field is not allowed.' })
  }
  const type = raw.type
  const label = raw.label
  const category = raw.category
  const version = raw.v
  if (typeof type !== 'string' || !BLOCK_TYPE_RE.test(type)) issues.push({ path: `${path}.type`, message: 'Use a block name that starts with a capital letter.' })
  if (typeof type === 'string' && typeof id === 'string' && `${id}/${type}`.length > 60) issues.push({ path: `${path}.type`, message: 'This block name is too long.' })
  if (typeof label !== 'string' || label.length < 1 || label.length > 40) issues.push({ path: `${path}.label`, message: 'Keep the label under 40 characters.' })
  if (typeof category !== 'string' || !CATEGORIES.includes(category as PluginCategory)) issues.push({ path: `${path}.category`, message: 'Use Headers, Text, Media, Calls to action, Embeds or Lists.' })
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 50) issues.push({ path: `${path}.v`, message: 'Use a whole version number, starting at 1.' })
  const template = relativeFile(raw.template, '.html')
  if (!template) issues.push({ path: `${path}.template`, message: 'Point this at an html file inside the package.' })
  else fileReady(files, template, `${path}.template`, 'This template is empty.', issues)
  let css: string | undefined
  if (raw.css !== undefined) {
    const cssPath = relativeFile(raw.css, '.css')
    if (!cssPath) issues.push({ path: `${path}.css`, message: 'Point this at a css file inside the package.' })
    else {
      fileReady(files, cssPath, `${path}.css`, 'This CSS file is empty.', issues)
      css = cssPath
    }
  }
  const compiled = compileObjectSchema(raw.props, { path: `${path}.props`, mode: 'block' })
  issues.push(...compiled.issues)
  let example: Record<string, unknown> | null = null
  if (!isRecord(raw.example)) issues.push({ path: `${path}.example`, message: 'The example must match the props.' })
  else if (compiled.schema && compiled.issues.length === 0) {
    const parsed = compiled.schema.safeParse(raw.example)
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 20)) {
        const suffix = issue.path.map(String).join('.')
        issues.push({ path: suffix ? `${path}.example.${suffix}` : `${path}.example`, message: 'The example must match the props.' })
      }
    } else if (isRecord(parsed.data)) example = parsed.data
  }
  const computed = checkComputed(raw.computed, `${path}.computed`, compiled.fields, issues)
  let writable = false
  let describe = ''
  if (raw.agent !== undefined) {
    if (!isRecord(raw.agent)) issues.push({ path: `${path}.agent`, message: 'This agent section is not valid.' })
    else {
      for (const key of Object.keys(raw.agent)) {
        if (key !== 'writable' && key !== 'describe') issues.push({ path: `${path}.agent.${key}`, message: 'This field is not allowed.' })
      }
      if (raw.agent.writable !== undefined && typeof raw.agent.writable !== 'boolean') issues.push({ path: `${path}.agent.writable`, message: 'Say yes or no.' })
      else if (raw.agent.writable === true) writable = true
      if (raw.agent.describe !== undefined && typeof raw.agent.describe !== 'string') issues.push({ path: `${path}.agent.describe`, message: 'This needs to be text.' })
      else if (typeof raw.agent.describe === 'string') {
        if (raw.agent.describe.length > PLUGIN_DESCRIBE_MAX) issues.push({ path: `${path}.agent.describe`, message: 'Keep this under 200 characters.' })
        else describe = raw.agent.describe
      }
    }
  }
  const agentNever: string[] = []
  if (raw.agentNever !== undefined) {
    if (!Array.isArray(raw.agentNever) || raw.agentNever.length > 40) issues.push({ path: `${path}.agentNever`, message: 'List the prop names agents must not set.' })
    else {
      raw.agentNever.forEach((name, nameIndex) => {
        if (typeof name !== 'string' || !compiled.names.has(name)) issues.push({ path: `${path}.agentNever.${nameIndex}`, message: 'This name is not a prop on the block.' })
        else agentNever.push(name)
      })
    }
  }
  let money = false
  if (raw.money !== undefined && typeof raw.money !== 'boolean') issues.push({ path: `${path}.money`, message: 'Say yes or no.' })
  else if (raw.money === true) money = true
  let imageSlots: PluginBlock['imageSlots']
  if (raw.imageSlots !== undefined) {
    if (!isRecord(raw.imageSlots)) issues.push({ path: `${path}.imageSlots`, message: 'Image sizes are not valid.' })
    else {
      imageSlots = {}
      for (const key of Object.keys(raw.imageSlots)) {
        if (!compiled.imagePaths.has(key)) {
          issues.push({ path: `${path}.imageSlots.${key}`, message: 'This image slot is not an image prop.' })
          continue
        }
        const slot = raw.imageSlots[key]
        if (!isRecord(slot) || Object.keys(slot).some((slotKey) => slotKey !== 'width' && slotKey !== 'height')) {
          issues.push({ path: `${path}.imageSlots.${key}`, message: 'Give a width and a height.' })
          continue
        }
        const width = slot.width
        const height = slot.height
        if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
          issues.push({ path: `${path}.imageSlots.${key}`, message: 'Give a width and a height.' })
          continue
        }
        imageSlots[key] = { width, height }
      }
    }
  }
  if (typeof type !== 'string' || !BLOCK_TYPE_RE.test(type) || typeof label !== 'string' || typeof category !== 'string' || !CATEGORIES.includes(category as PluginCategory)) return null
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null
  if (!template || !example || !isRecord(raw.props)) return null
  return {
    type,
    v: version,
    label,
    category: category as PluginCategory,
    props: raw.props,
    template,
    ...(css ? { css } : {}),
    example,
    computed,
    agent: { writable, describe },
    agentNever,
    money,
    ...(imageSlots ? { imageSlots } : {}),
  }
}

function readHead(raw: unknown, index: number, stringSettings: Set<string>, cspOrigins: Set<string>, issues: FieldIssue[]): PluginHead | null {
  const path = `head.${index}`
  if (!isRecord(raw)) {
    issues.push({ path, message: 'This head entry is not valid.' })
    return null
  }
  if (raw.tag === 'meta') {
    for (const key of Object.keys(raw)) {
      if (!['tag', 'name', 'property', 'content'].includes(key)) issues.push({ path: `${path}.${key}`, message: 'This field is not allowed.' })
    }
    const hasName = typeof raw.name === 'string' && raw.name.length > 0 && raw.name.length <= 80
    const hasProperty = typeof raw.property === 'string' && raw.property.length > 0 && raw.property.length <= 80
    if (hasName === hasProperty) issues.push({ path, message: 'A meta tag needs a name or a property, not both.' })
    if (typeof raw.content !== 'string' || raw.content.length < 1 || raw.content.length > 500) issues.push({ path: `${path}.content`, message: 'Add the meta content.' })
    else if (!checkHeadValue(raw.content, stringSettings, cspOrigins, `${path}.content`, issues)) return null
    if (!hasName && !hasProperty) return null
    if (typeof raw.content !== 'string') return null
    return { tag: 'meta', ...(hasName ? { name: raw.name as string } : {}), ...(hasProperty ? { property: raw.property as string } : {}), content: raw.content }
  }
  if (raw.tag === 'link') {
    for (const key of Object.keys(raw)) {
      if (!['tag', 'rel', 'href'].includes(key)) issues.push({ path: `${path}.${key}`, message: 'This field is not allowed.' })
    }
    if (raw.rel !== 'preconnect' && raw.rel !== 'alternate') issues.push({ path: `${path}.rel`, message: 'Use preconnect or alternate.' })
    if (typeof raw.href !== 'string' || !checkHeadValue(raw.href, stringSettings, cspOrigins, `${path}.href`, issues)) {
      if (typeof raw.href !== 'string') issues.push({ path: `${path}.href`, message: 'Use a site path or an https address.' })
      return null
    }
    if (raw.rel !== 'preconnect' && raw.rel !== 'alternate') return null
    return { tag: 'link', rel: raw.rel, href: raw.href }
  }
  issues.push({ path, message: 'Head entries can only be a meta tag or a link.' })
  return null
}

function checkHeadValue(value: string, stringSettings: Set<string>, cspOrigins: Set<string>, path: string, issues: FieldIssue[]): boolean {
  const setting = SETTINGS_REF.exec(value)
  if (setting?.[1]) {
    if (!stringSettings.has(setting[1])) {
      issues.push({ path, message: 'This setting is not a text field on the plugin.' })
      return false
    }
    return true
  }
  if (isSitePath(value)) return true
  const origin = parseOrigin(value) ?? (value.startsWith('https://') ? safeOrigin(value) : null)
  if (!origin || !cspOrigins.has(origin)) {
    issues.push({ path, message: 'List this address in the plugin allowed origins, or use a site path.' })
    return false
  }
  return true
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

function stringSettingNames(settings: Record<string, unknown> | undefined): Set<string> {
  if (!settings || !isRecord(settings.fields)) return new Set()
  const names = new Set<string>()
  for (const [key, field] of Object.entries(settings.fields)) {
    if (isRecord(field) && field.type === 'string') names.add(key)
  }
  return names
}

/**
 * Parse a manifest object. Pass the archive files when the template and CSS paths must exist.
 * Messages name the path and do not include the rejected value.
 */
export function parseManifest(raw: unknown, files: ReadonlyMap<string, Buffer> | null = null): { ok: true; value: ParsedManifest } | { ok: false; issues: FieldIssue[] } {
  const issues: FieldIssue[] = []
  if (!isRecord(raw)) return { ok: false, issues: [{ path: '(manifest)', message: 'The manifest must be an object.' }] }
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) issues.push({ path: key, message: 'This field is not allowed.' })
  }
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) issues.push({ path: 'id', message: 'Use a short name: a letter, then lowercase letters, numbers or hyphens.' })
  if (typeof raw.name !== 'string' || raw.name.trim().length < 1 || raw.name.length > 60) issues.push({ path: 'name', message: 'Keep the name under 60 characters.' })
  if (typeof raw.version !== 'string' || !parseSemver(raw.version)) issues.push({ path: 'version', message: 'Use a version like 1.2.3.' })
  if (typeof raw.sitebuilder !== 'string' || !satisfiesCore(raw.sitebuilder)) issues.push({ path: 'sitebuilder', message: 'This plugin does not support this version of sitebuilder.' })
  let permissions: PluginPermission[] = []
  if (!Array.isArray(raw.permissions) || raw.permissions.length < 1 || raw.permissions.length > 3) issues.push({ path: 'permissions', message: 'List the permissions this plugin needs.' })
  else {
    const seen = new Set<string>()
    for (const permission of raw.permissions) {
      if (typeof permission !== 'string' || !PERMISSIONS.includes(permission as PluginPermission) || seen.has(permission)) {
        issues.push({ path: 'permissions', message: 'Permissions can only be blocks, head and settings.' })
        permissions = []
        break
      }
      seen.add(permission)
      permissions.push(permission as PluginPermission)
    }
  }
  const csp = readCsp(raw.csp, issues)
  const settingsCompiled = raw.settings === undefined ? null : compileObjectSchema(raw.settings, { path: 'settings', mode: 'settings' })
  if (settingsCompiled) issues.push(...settingsCompiled.issues)
  const stringSettings = stringSettingNames(isRecord(raw.settings) ? raw.settings : undefined)
  const cspOrigins = new Set<string>(csp ? [...csp.img, ...csp.frame, ...csp.connect, ...csp.font] : [])
  if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > PLUGIN_MAX_BLOCKS) issues.push({ path: 'blocks', message: 'A plugin needs between 1 and 8 blocks.' })
  const blocks: PluginBlock[] = []
  const seenTypes = new Set<string>()
  if (Array.isArray(raw.blocks)) {
    raw.blocks.forEach((block, index) => {
      const parsed = readBlock(block, index, typeof raw.id === 'string' ? raw.id : '', files, stringSettings, issues)
      if (!parsed) return
      if (seenTypes.has(parsed.type)) issues.push({ path: `blocks.${index}.type`, message: 'Two blocks in this plugin use the same name.' })
      seenTypes.add(parsed.type)
      blocks.push(parsed)
    })
  }
  const head: PluginHead[] = []
  if (raw.head !== undefined) {
    if (!Array.isArray(raw.head) || raw.head.length > 8) issues.push({ path: 'head', message: 'Use at most 8 head entries.' })
    else raw.head.forEach((entry, index) => {
      const parsed = readHead(entry, index, stringSettings, cspOrigins, issues)
      if (parsed) head.push(parsed)
    })
  }
  let migrations: PluginManifest['migrations']
  if (raw.migrations !== undefined) {
    if (!isRecord(raw.migrations)) issues.push({ path: 'migrations', message: 'Migrations must be listed by block name.' })
    else {
      migrations = {}
      for (const key of Object.keys(raw.migrations)) {
        if (!BLOCK_TYPE_RE.test(key) || !seenTypes.has(key)) {
          issues.push({ path: `migrations.${key}`, message: 'This migration is for a block that is not in the plugin.' })
          continue
        }
        const block = blocks.find((item) => item.type === key)
        const table = raw.migrations[key]
        if (!isRecord(table)) {
          issues.push({ path: `migrations.${key}`, message: 'This migration is not valid.' })
          continue
        }
        const map = table as MigrationMap
        issues.push(...migrationStepIssues(block?.v ?? 1, map, `migrations.${key}`))
        migrations[key] = map
      }
    }
  }
  for (const block of blocks) {
    if (block.v > 1) issues.push(...migrationStepIssues(block.v, migrations?.[block.type], `migrations.${block.type}`))
  }
  if (blocks.length && !permissions.includes('blocks')) issues.push({ path: 'permissions', message: 'Add the blocks permission.' })
  if (head.length && !permissions.includes('head')) issues.push({ path: 'permissions', message: 'Add the head permission to use head tags.' })
  if (raw.settings !== undefined && !permissions.includes('settings')) issues.push({ path: 'permissions', message: 'Add the settings permission to use settings.' })
  if (issues.length || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.version !== 'string' || typeof raw.sitebuilder !== 'string' || !csp) {
    return { ok: false, issues: issues.slice(0, 50) }
  }
  const origins = collectOrigins(csp, head)
  const manifest: PluginManifest = {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    sitebuilder: raw.sitebuilder,
    permissions,
    csp,
    blocks,
    head,
    ...(isRecord(raw.settings) ? { settings: raw.settings } : {}),
    ...(migrations ? { migrations } : {}),
  }
  return { ok: true, value: { manifest, origins } }
}

function collectOrigins(csp: PluginManifest['csp'], head: PluginHead[]): PluginOrigin[] {
  const origins: PluginOrigin[] = []
  for (const directive of ['img', 'frame', 'connect', 'font'] as const) {
    for (const origin of csp[directive]) origins.push({ directive, origin })
  }
  for (const entry of head) {
    if (entry.tag !== 'link') continue
    if (SETTINGS_REF.test(entry.href)) origins.push({ directive: 'head', origin: entry.href })
  }
  return origins
}

export function blockDefinitions(manifest: PluginManifest, trust: 'official' | 'self'): BlockDefinition[] {
  return manifest.blocks.map((block) => {
    const compiled = compileObjectSchema(block.props, { path: 'props', mode: 'block' })
    if (!compiled.schema) throw new Error('The plugin manifest is not valid.')
    const definition = defineBlock({
      type: `${manifest.id}/${block.type}`,
      version: block.v,
      label: block.label,
      category: block.category,
      props: compiled.schema as z.ZodObject,
      sample: block.example as z.input<z.ZodObject>,
      migrations: compileMigrations(block.v, manifest.migrations?.[block.type]),
      ...(block.imageSlots ? { imageSlots: block.imageSlots } : {}),
      plugin: {
        id: manifest.id,
        trust,
        money: block.money,
        writable: block.agent.writable,
        describe: block.agent.describe,
        agentNever: block.agentNever,
      },
    })
    return definition
  })
}
