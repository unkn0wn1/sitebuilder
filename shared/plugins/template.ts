// Logic-less plugin templates. The compiler returns a VNode function and does not import the page renderer.
import { h, type VNode } from 'vue'
import type { CompiledField } from './schema-subset'
import type { ComputedField } from './manifest'
import { computeMoney, computePercent, computeSvgScale, readPath, type ComputedValue } from './compute'
import {
  CLASS_ID,
  FILL_KEYS,
  NUMERIC_ATTRS,
  VOID_TAGS,
  canonicalAttr,
  canonicalTag,
  pluginElementId,
} from './html-allow'

export class TemplateRejected extends Error {
  readonly line: number
  readonly column: number

  constructor(line: number, column: number, message: string) {
    super(message)
    this.name = 'TemplateRejected'
    this.line = line > 0 ? line : 1
    this.column = column > 0 ? column : 1
  }
}

export interface TemplateHooks {
  richtext: (value: unknown) => VNode | VNode[] | null
  image: (value: unknown, slot: { width: number; height: number }) => VNode | null
  link: (value: unknown) => VNode | null
}

export interface TemplateData {
  props: Record<string, unknown>
  computed: Record<string, ComputedValue>
  settings: Record<string, unknown>
  sectionId: string
  blockSlug: string
}

export interface TemplateSetting {
  name: string
  type: 'string' | 'number' | 'boolean' | 'enum'
}

export interface CompileTemplateInput {
  fields: CompiledField[]
  computed: ComputedField[]
  settings?: TemplateSetting[]
  imageSlots?: Record<string, { width: number; height: number }>
}

export type CompiledTemplate = (data: TemplateData, hooks: TemplateHooks) => VNode

const HELPERS = new Set(['money', 'percent', 'svg-scale', 'richtext', 'image', 'link'])
const ELEMENT_HELPERS = new Set(['richtext', 'image', 'link'])
const NUMBER_HELPERS = new Set(['percent', 'svg-scale'])
const LOCAL_URL = /^url\(\s*#([A-Za-z0-9_:-]{1,64})\s*\)$/
const NUMERIC_LITERAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

type Expr =
  | { kind: 'path'; path: string }
  | { kind: 'helper'; name: string; args: Arg[] }

type Arg = { kind: 'path'; path: string } | { kind: 'int'; value: number }

type Attr = { name: string; value: string | Expr; line: number; column: number }

type AstNode =
  | { kind: 'text'; text: string }
  | { kind: 'mustache'; expr: Expr; line: number; column: number }
  | { kind: 'element'; tag: string; attrs: Attr[]; children: AstNode[] }
  | { kind: 'section'; name: string; inverse: boolean; children: AstNode[]; line: number; column: number }

type ValueKind = 'string' | 'number' | 'boolean' | 'enum' | 'link' | 'image' | 'richtext' | 'list' | 'object' | 'fill'

interface ScopeFields {
  item: CompiledField[] | null
  listName: string | null
}

class Parser {
  private i = 0
  private line = 1
  private column = 1

  constructor(private readonly source: string) {}

  parse(): AstNode[] {
    return this.parseContent({ endTag: null, section: null, listDepth: 0, inSvg: false })
  }

  private pos(): { line: number; column: number } {
    return { line: this.line, column: this.column }
  }

  private eof(): boolean {
    return this.i >= this.source.length
  }

  private peek(): string {
    return this.source[this.i] ?? ''
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.i)
  }

  private bump(): string {
    const ch = this.source[this.i] ?? ''
    this.i += 1
    if (ch === '\n') {
      this.line += 1
      this.column = 1
    } else this.column += 1
    return ch
  }

  private fail(at: { line: number; column: number }, message: string): never {
    throw new TemplateRejected(at.line, at.column, message)
  }

  private skipSpace(): void {
    while (!this.eof()) {
      const ch = this.peek()
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return
      this.bump()
    }
  }

  private expect(text: string, at: { line: number; column: number }): void {
    if (!this.startsWith(text)) this.fail(at, 'This template is not valid.')
    for (let n = 0; n < text.length; n++) this.bump()
  }

  private parseContent(opts: { endTag: string | null; section: string | null; listDepth: number; inSvg: boolean }): AstNode[] {
    const nodes: AstNode[] = []
    while (!this.eof()) {
      if (this.startsWith('</')) {
        if (!opts.endTag) this.fail(this.pos(), 'This closing tag does not match.')
        const at = this.pos()
        const name = this.readEndTag()
        if (name !== opts.endTag) this.fail(at, 'This closing tag does not match.')
        return nodes
      }
      if (this.startsWith('<')) {
        nodes.push(this.parseElement(opts.inSvg, opts.listDepth))
        continue
      }
      if (this.startsWith('{{{')) this.fail(this.pos(), 'This template cannot include raw HTML.')
      if (this.startsWith('{{')) {
        const found = this.parseMustache(opts)
        if (found === 'closed') return nodes
        nodes.push(found)
        continue
      }
      nodes.push({ kind: 'text', text: this.readRawText() })
    }
    if (opts.endTag || opts.section) this.fail(this.pos(), 'Close the open tag.')
    return nodes
  }

  private readRawText(): string {
    const start = this.i
    while (!this.eof() && !this.startsWith('<') && !this.startsWith('{{')) this.bump()
    if (this.i === start) this.fail(this.pos(), 'This template is not valid.')
    return this.source.slice(start, this.i)
  }

  /** Returns the section-close sentinel when the matching end tag is consumed. */
  private parseMustache(opts: { endTag: string | null; section: string | null; listDepth: number; inSvg: boolean }): AstNode | 'closed' {
    const at = this.pos()
    this.expect('{{', at)
    this.skipSpace()
    const sigil = this.peek()
    if (sigil === '!') {
      this.bump()
      this.readComment(at)
      return { kind: 'text', text: '' }
    }
    if (sigil === '#' || sigil === '^' || sigil === '/') {
      const kind = this.bump()
      this.skipSpace()
      const name = this.readIdent(at)
      this.skipSpace()
      this.expect('}}', at)
      if (kind === '/') {
        if (opts.section !== name) this.fail(at, 'This closing tag does not match.')
        return 'closed'
      }
      if (kind === '#' && opts.listDepth > 0) this.fail(at, 'A list cannot contain another list.')
      const children = this.parseContent({
        endTag: null,
        section: name,
        listDepth: opts.listDepth + (kind === '#' ? 1 : 0),
        inSvg: opts.inSvg,
      })
      return { kind: 'section', name, inverse: kind === '^', children, line: at.line, column: at.column }
    }
    const expr = this.parseExpr(at)
    return { kind: 'mustache', expr, line: at.line, column: at.column }
  }

  private readComment(at: { line: number; column: number }): void {
    while (!this.eof()) {
      if (this.startsWith('}}')) {
        this.bump()
        this.bump()
        return
      }
      this.bump()
    }
    this.fail(at, 'This template is not valid.')
  }

  private parseExpr(at: { line: number; column: number }): Expr {
    const name = this.readToken(at)
    this.skipSpace()
    if (name.includes('-') || (HELPERS.has(name) && this.startsArg())) {
      if (!HELPERS.has(name)) this.fail(at, 'This helper is not valid.')
      const args: Arg[] = []
      while (!this.startsWith('}}')) {
        if (this.eof()) this.fail(at, 'This template is not valid.')
        this.skipSpace()
        if (this.startsWith('}}')) break
        args.push(this.readArg(at))
        this.skipSpace()
      }
      this.expect('}}', at)
      return { kind: 'helper', name, args }
    }
    const parts = [name]
    while (this.peek() === '.') {
      this.bump()
      parts.push(this.readIdent(at))
    }
    this.skipSpace()
    this.expect('}}', at)
    return { kind: 'path', path: parts.join('.') }
  }

  private startsArg(): boolean {
    const ch = this.peek()
    return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || (ch >= '0' && ch <= '9')
  }

  private readArg(at: { line: number; column: number }): Arg {
    const ch = this.peek()
    if (ch >= '0' && ch <= '9') {
      const start = this.i
      while (!this.eof() && this.peek() >= '0' && this.peek() <= '9') this.bump()
      const text = this.source.slice(start, this.i)
      if (text.length > 1 && text.startsWith('0')) this.fail(at, 'This helper is not valid.')
      const value = Number(text)
      if (!Number.isSafeInteger(value)) this.fail(at, 'This helper is not valid.')
      return { kind: 'int', value }
    }
    const token = this.readToken(at)
    if (token.includes('-')) this.fail(at, 'This helper is not valid.')
    const parts = [token]
    while (this.peek() === '.') {
      this.bump()
      parts.push(this.readIdent(at))
    }
    return { kind: 'path', path: parts.join('.') }
  }

  private readToken(at: { line: number; column: number }): string {
    const ch = this.peek()
    if (!this.isIdentStart(ch)) this.fail(at, 'This template is not valid.')
    const start = this.i
    this.bump()
    while (!this.eof()) {
      const next = this.peek()
      if (!this.isIdentPart(next) && next !== '-') break
      this.bump()
    }
    return this.source.slice(start, this.i)
  }

  private readIdent(at: { line: number; column: number }): string {
    const token = this.readToken(at)
    if (token.includes('-')) this.fail(at, 'This template is not valid.')
    return token
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_'
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= '0' && ch <= '9')
  }

  private parseElement(inSvg: boolean, listDepth: number): AstNode {
    const at = this.pos()
    this.bump()
    if (this.peek() === '/' || this.peek() === '!' || this.peek() === '?') this.fail(at, 'This tag is not allowed.')
    const raw = this.readTagName(at)
    const attrs = this.parseAttrs(at)
    let selfClose = false
    this.skipSpace()
    if (this.peek() === '/') {
      selfClose = true
      this.bump()
    }
    this.skipSpace()
    if (this.peek() !== '>') this.fail(at, 'This template is not valid.')
    this.bump()
    const tag = canonicalTag(raw, inSvg)
    if (!tag) this.fail(at, 'This tag is not allowed.')
    const childSvg = inSvg || tag === 'svg'
    const children = selfClose || VOID_TAGS.has(tag) ? [] : this.parseContent({ endTag: tag, section: null, listDepth, inSvg: childSvg })
    return { kind: 'element', tag, attrs, children }
  }

  private readTagName(at: { line: number; column: number }): string {
    if (!this.isIdentStart(this.peek())) this.fail(at, 'This tag is not allowed.')
    const start = this.i
    this.bump()
    while (this.isIdentPart(this.peek())) this.bump()
    return this.source.slice(start, this.i)
  }

  private readEndTag(): string {
    const at = this.pos()
    this.expect('</', at)
    this.skipSpace()
    const name = this.readTagName(at)
    this.skipSpace()
    if (this.peek() !== '>') this.fail(at, 'This template is not valid.')
    this.bump()
    return canonicalTag(name, true) ?? canonicalTag(name, false) ?? name.toLowerCase()
  }

  private parseAttrs(at: { line: number; column: number }): Attr[] {
    const attrs: Attr[] = []
    const seen = new Set<string>()
    while (!this.eof()) {
      this.skipSpace()
      const ch = this.peek()
      if (ch === '>' || ch === '/' || ch === '') break
      const attrAt = this.pos()
      const rawName = this.readAttrName(attrAt)
      this.skipSpace()
      if (this.peek() !== '=') this.fail(attrAt, 'This template is not valid.')
      this.bump()
      this.skipSpace()
      const value = this.readAttrValue(attrAt)
      if (seen.has(rawName.toLowerCase())) this.fail(attrAt, 'This attribute is repeated.')
      seen.add(rawName.toLowerCase())
      attrs.push({ name: rawName, value, line: attrAt.line, column: attrAt.column })
    }
    if (this.eof()) this.fail(at, 'This template is not valid.')
    return attrs
  }

  private readAttrName(at: { line: number; column: number }): string {
    const ch = this.peek()
    if (!this.isIdentStart(ch)) this.fail(at, 'This attribute is not allowed.')
    const start = this.i
    this.bump()
    while (!this.eof()) {
      const next = this.peek()
      if (!this.isIdentPart(next) && next !== '-' && next !== ':' && next !== '.') break
      this.bump()
    }
    return this.source.slice(start, this.i)
  }

  private readAttrValue(at: { line: number; column: number }): string | Expr {
    const quote = this.peek()
    if (quote !== '"' && quote !== "'") this.fail(at, 'This template is not valid.')
    this.bump()
    this.skipSpace()
    if (this.startsWith('{{')) {
      if (this.startsWith('{{{')) this.fail(this.pos(), 'This template cannot include raw HTML.')
      const exprAt = this.pos()
      this.expect('{{', exprAt)
      const expr = this.parseExpr(exprAt)
      this.skipSpace()
      if (this.peek() !== quote) this.fail(at, 'This template is not valid.')
      this.bump()
      return expr
    }
    let value = ''
    while (!this.eof() && this.peek() !== quote) {
      if (this.startsWith('{{')) this.fail(this.pos(), 'This template is not valid.')
      value += this.bump()
      if (value.length > 4000) this.fail(at, 'This template is not valid.')
    }
    if (this.peek() !== quote) this.fail(at, 'This template is not valid.')
    this.bump()
    return value
  }
}

interface Kinds {
  fields: CompiledField[]
  computed: ComputedField[]
  settings: TemplateSetting[]
}

function kindOf(path: string, scope: ScopeFields, kinds: Kinds): ValueKind | null {
  const parts = path.split('.')
  const head = parts[0]
  if (!head) return null
  if (scope.item) {
    const item = scope.item.find((field) => field.name === head)
    if (item) return walkField(item, parts.slice(1))
  }
  const prop = kinds.fields.find((field) => field.name === head)
  if (prop) return walkField(prop, parts.slice(1))
  const computed = kinds.computed.find((field) => field.name === head)
  if (computed) {
    if (computed.op === 'match-fill') {
      if (parts.length === 1) return 'fill'
      if (parts.length === 2 && FILL_KEYS.has(parts[1] ?? '')) return 'number'
      return null
    }
    if (parts.length !== 1) return null
    return computed.op === 'money' ? 'string' : 'number'
  }
  const setting = kinds.settings.find((field) => field.name === head)
  if (setting && parts.length === 1) return setting.type
  return null
}

function walkField(field: CompiledField, rest: string[]): ValueKind | null {
  if (rest.length === 0) return field.type
  if ((field.type !== 'object' && field.type !== 'list') || !field.children) return null
  const next = field.children.find((child) => child.name === rest[0])
  if (!next) return null
  return walkField(next, rest.slice(1))
}

function isAmountKind(kind: ValueKind | null): boolean {
  return kind === 'string' || kind === 'number'
}

function isNumberKind(kind: ValueKind | null): boolean {
  return kind === 'number'
}

function isTextKind(kind: ValueKind | null): boolean {
  return kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'enum'
}

function checkExpr(expr: Expr, at: { line: number; column: number }, scope: ScopeFields, kinds: Kinds, where: 'text' | 'number' | 'element'): void {
  if (expr.kind === 'path') {
    const kind = kindOf(expr.path, scope, kinds)
    if (!kind) throw new TemplateRejected(at.line, at.column, 'This field is not on the block.')
    if (where === 'text' && !isTextKind(kind)) throw new TemplateRejected(at.line, at.column, 'This value cannot be shown as text.')
    if (where === 'number' && !isNumberKind(kind)) throw new TemplateRejected(at.line, at.column, 'This value must be a number.')
    if (where === 'element') throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    return
  }
  checkHelper(expr, at, scope, kinds, where)
}

function checkHelper(expr: Extract<Expr, { kind: 'helper' }>, at: { line: number; column: number }, scope: ScopeFields, kinds: Kinds, where: 'text' | 'number' | 'element'): void {
  const pathArg = (arg: Arg | undefined, expected: ValueKind | ((kind: ValueKind | null) => boolean)): void => {
    if (!arg || arg.kind !== 'path') throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    const kind = kindOf(arg.path, scope, kinds)
    const ok = typeof expected === 'function' ? expected(kind) : kind === expected
    if (!ok) throw new TemplateRejected(at.line, at.column, 'This field is not on the block.')
  }
  if (expr.name === 'money') {
    if (where === 'number' || where === 'element') throw new TemplateRejected(at.line, at.column, 'This value must be a number.')
    if (expr.args.length < 1 || expr.args.length > 2) throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    pathArg(expr.args[0], isAmountKind)
    if (expr.args[1]) pathArg(expr.args[1], (kind) => kind === 'string' || kind === 'enum')
    return
  }
  if (expr.name === 'percent') {
    if (where === 'element') throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    if (expr.args.length !== 2) throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    for (const arg of expr.args) {
      if (arg.kind === 'int') continue
      pathArg(arg, isAmountKind)
    }
    return
  }
  if (expr.name === 'svg-scale') {
    if (where === 'element') throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    if (expr.args.length !== 3 || expr.args[2]?.kind !== 'int') throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    const max = expr.args[2].value
    if (max < 1 || max > 2000) throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    pathArg(expr.args[0], isAmountKind)
    pathArg(expr.args[1], isAmountKind)
    return
  }
  if (expr.name === 'richtext' || expr.name === 'image' || expr.name === 'link') {
    if (where !== 'element') throw new TemplateRejected(at.line, at.column, 'This value cannot be shown as text.')
    if (expr.args.length !== 1) throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
    const expect = expr.name === 'richtext' ? 'richtext' : expr.name === 'image' ? 'image' : 'link'
    pathArg(expr.args[0], expect)
    return
  }
  throw new TemplateRejected(at.line, at.column, 'This helper is not valid.')
}

function validate(nodes: AstNode[], scope: ScopeFields, kinds: Kinds, ids: Set<string>, listDepth: number): void {
  for (const node of nodes) {
    if (node.kind === 'text') continue
    if (node.kind === 'mustache') {
      const where = node.expr.kind === 'helper' && ELEMENT_HELPERS.has(node.expr.name) ? 'element' : 'text'
      checkExpr(node.expr, node, scope, kinds, where)
      continue
    }
    if (node.kind === 'section') {
      const kind = kindOf(node.name, scope, kinds)
      if (kind !== 'list' && kind !== 'boolean' && kind !== 'string' && kind !== 'enum') {
        throw new TemplateRejected(node.line, node.column, 'This field is not on the block.')
      }
      const nextScope: ScopeFields = { item: scope.item, listName: scope.listName }
      let nextDepth = listDepth
      if (!node.inverse && kind === 'list') {
        const field = (scope.item ?? kinds.fields).find((item) => item.name === node.name)
        nextScope.item = field?.children ?? []
        nextScope.listName = node.name
        nextDepth = listDepth + 1
      }
      validate(node.children, nextScope, kinds, ids, nextDepth)
      continue
    }
    for (const attr of node.attrs) {
      const canonical = canonicalAttr(node.tag, attr.name)
      if (!canonical) throw new TemplateRejected(attr.line, attr.column, 'This attribute is not allowed.')
      attr.name = canonical
      if (typeof attr.value === 'string') checkLiteralAttr(node.tag, attr, ids, listDepth)
      else checkAttrExpr(node.tag, attr, scope, kinds)
    }
    validate(node.children, scope, kinds, ids, listDepth)
  }
}

function checkLiteralAttr(tag: string, attr: Attr, ids: Set<string>, _listDepth: number): void {
  const value = attr.value
  if (typeof value !== 'string') return
  const lower = value.toLowerCase()
  if (lower.includes('javascript:') || lower.includes('vbscript:')) {
    throw new TemplateRejected(attr.line, attr.column, 'Only a local reference is allowed here.')
  }
  if (attr.name === 'class' || attr.name === 'id') {
    if (!CLASS_ID.test(value)) throw new TemplateRejected(attr.line, attr.column, 'This class or id is not valid.')
  }
  if (!lower.includes('url(')) {
    if ((tag === 'progress' && (attr.name === 'max' || attr.name === 'value')) && !NUMERIC_LITERAL.test(value)) {
      throw new TemplateRejected(attr.line, attr.column, 'This value must be a number.')
    }
    return
  }
  const match = LOCAL_URL.exec(value)
  if (!match || !ids.has(match[1] ?? '')) throw new TemplateRejected(attr.line, attr.column, 'Only a local reference is allowed here.')
}

function checkAttrExpr(tag: string, attr: Attr, scope: ScopeFields, kinds: Kinds): void {
  if (typeof attr.value === 'string') return
  if (attr.name === 'class' || attr.name === 'id') throw new TemplateRejected(attr.line, attr.column, 'This class or id is not valid.')
  if (attr.name === 'clip-path') throw new TemplateRejected(attr.line, attr.column, 'Only a local reference is allowed here.')
  if (!NUMERIC_ATTRS.has(attr.name)) throw new TemplateRejected(attr.line, attr.column, 'This value must be a number.')
  const where = attr.value.kind === 'helper' && NUMBER_HELPERS.has(attr.value.name) ? 'number' : 'number'
  checkExpr(attr.value, attr, scope, kinds, where)
  if (tag === 'progress' && attr.value.kind === 'path') {
    const kind = kindOf(attr.value.path, scope, kinds)
    if (kind !== 'number') throw new TemplateRejected(attr.line, attr.column, 'This value must be a number.')
  }
}

function singleRoot(nodes: AstNode[]): Extract<AstNode, { kind: 'element' }> {
  const meaningful = nodes.filter((node) => node.kind !== 'text' || node.text.trim() !== '')
  const only = meaningful.length === 1 ? meaningful[0] : undefined
  if (!only || only.kind !== 'element') throw new TemplateRejected(1, 1, 'Use one root element.')
  return only
}

interface RenderScope {
  item: Record<string, unknown> | null
  listName: string | null
}

function lookup(path: string, scope: RenderScope, data: TemplateData): unknown {
  const head = path.split('.')[0]
  if (!head) return undefined
  if (scope.item && Object.prototype.hasOwnProperty.call(scope.item, head)) return readPath(scope.item, path)
  if (Object.prototype.hasOwnProperty.call(data.props, head)) return readPath(data.props, path)
  if (Object.prototype.hasOwnProperty.call(data.computed, head)) return readPath(data.computed, path)
  if (Object.prototype.hasOwnProperty.call(data.settings, head)) return readPath(data.settings, path)
  return undefined
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

function evalArg(arg: Arg, scope: RenderScope, data: TemplateData): unknown {
  if (arg.kind === 'int') return arg.value
  return lookup(arg.path, scope, data)
}

function slotFor(path: string, slots: Record<string, { width: number; height: number }> | undefined, listName: string | null): { width: number; height: number } {
  if (slots?.[path]) return slots[path]
  if (listName && slots?.[`${listName}.${path}`]) return slots[`${listName}.${path}`]!
  return { width: 960, height: 720 }
}

type Child = string | VNode | (string | VNode)[] | null

function evalExpr(expr: Expr, scope: RenderScope, data: TemplateData, hooks: TemplateHooks, slots: CompileTemplateInput['imageSlots']): Child {
  if (expr.kind === 'path') return textOf(lookup(expr.path, scope, data))
  if (expr.name === 'money') {
    const amount = evalArg(expr.args[0]!, scope, data)
    const currency = expr.args[1] ? evalArg(expr.args[1], scope, data) : data.props.currency
    return computeMoney(amount, currency)
  }
  if (expr.name === 'percent') return String(computePercent(evalArg(expr.args[0]!, scope, data), evalArg(expr.args[1]!, scope, data)))
  if (expr.name === 'svg-scale') {
    const max = expr.args[2]
    return String(computeSvgScale(evalArg(expr.args[0]!, scope, data), evalArg(expr.args[1]!, scope, data), max && max.kind === 'int' ? max.value : 0))
  }
  const arg = expr.args[0]
  if (!arg || arg.kind !== 'path') return null
  const value = lookup(arg.path, scope, data)
  if (expr.name === 'richtext') return hooks.richtext(value)
  if (expr.name === 'image') return hooks.image(value, slotFor(arg.path, slots, scope.listName))
  if (expr.name === 'link') return hooks.link(value)
  return null
}

function pushChild(children: (string | VNode)[], child: Child): void {
  if (child === null || child === '') return
  if (Array.isArray(child)) {
    for (const item of child) if (item) children.push(item)
    return
  }
  children.push(child)
}

function sectionActive(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => !!item && typeof item === 'object' && !Array.isArray(item))
  if (value === true) return true
  if (typeof value === 'string' && value.length > 0) return true
  return false
}

function renderNodes(nodes: AstNode[], scope: RenderScope, data: TemplateData, hooks: TemplateHooks, slots: CompileTemplateInput['imageSlots']): (string | VNode)[] {
  const children: (string | VNode)[] = []
  for (const node of nodes) pushChild(children, renderNode(node, scope, data, hooks, slots))
  return children
}

function renderNode(node: AstNode, scope: RenderScope, data: TemplateData, hooks: TemplateHooks, slots: CompileTemplateInput['imageSlots']): Child {
  if (node.kind === 'text') return node.text
  if (node.kind === 'mustache') return evalExpr(node.expr, scope, data, hooks, slots)
  if (node.kind === 'section') {
    const value = lookup(node.name, scope, data)
    const active = sectionActive(value)
    if (node.inverse) {
      if (active) return null
      return renderNodes(node.children, scope, data, hooks, slots)
    }
    if (Array.isArray(value)) {
      const items = value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      if (!items.length) return null
      return items.flatMap((item) => renderNodes(node.children, { item, listName: node.name }, data, hooks, slots))
    }
    if (!active) return null
    return renderNodes(node.children, scope, data, hooks, slots)
  }
  const props: Record<string, string | number> = {}
  for (const attr of node.attrs) {
    if (typeof attr.value === 'string') {
      if (attr.name === 'id') props.id = pluginElementId(data.blockSlug, data.sectionId, attr.value)
      else {
        const match = LOCAL_URL.exec(attr.value)
        props[attr.name] = match?.[1] ? `url(#${pluginElementId(data.blockSlug, data.sectionId, match[1])})` : attr.value
      }
      continue
    }
    const value = evalExpr(attr.value, scope, data, hooks, slots)
    if (typeof value === 'number' && Number.isFinite(value)) props[attr.name] = value
    else props[attr.name] = textOf(value)
  }
  const children = renderNodes(node.children, scope, data, hooks, slots)
  return children.length ? h(node.tag, props, children) : h(node.tag, props)
}

export function compileTemplate(source: string, input: CompileTemplateInput): CompiledTemplate {
  const parser = new Parser(source)
  const nodes = parser.parse()
  const root = singleRoot(nodes)
  const kinds: Kinds = { fields: input.fields, computed: input.computed, settings: input.settings ?? [] }
  const ids = new Set<string>()
  // Ids are collected while attributes are checked, and url(#id) needs the set first.
  // A first walk records ids, a second walk checks urls. validate does both in one walk,
  // so a forward reference to an id declared later would fail. Collect ids first.
  collectIds(nodes, ids, 0)
  validate(nodes, { item: null, listName: null }, kinds, ids, 0)
  return (data, hooks) => {
    const vnode = renderNode(root, { item: null, listName: null }, data, hooks, input.imageSlots)
    if (!vnode || typeof vnode === 'string' || Array.isArray(vnode)) throw new TemplateRejected(1, 1, 'Use one root element.')
    return vnode
  }
}

function collectIds(nodes: AstNode[], ids: Set<string>, listDepth: number): void {
  for (const node of nodes) {
    if (node.kind === 'element') {
      for (const attr of node.attrs) {
        if (attr.name.toLowerCase() !== 'id' || typeof attr.value !== 'string') continue
        if (listDepth > 0) throw new TemplateRejected(attr.line, attr.column, 'An id cannot sit inside a list.')
        if (!CLASS_ID.test(attr.value)) throw new TemplateRejected(attr.line, attr.column, 'This class or id is not valid.')
        if (ids.has(attr.value)) throw new TemplateRejected(attr.line, attr.column, 'This id is already used.')
        ids.add(attr.value)
      }
      collectIds(node.children, ids, listDepth)
    } else if (node.kind === 'section' && !node.inverse) {
      collectIds(node.children, ids, listDepth + 1)
    } else if (node.kind === 'section') collectIds(node.children, ids, listDepth)
  }
}
