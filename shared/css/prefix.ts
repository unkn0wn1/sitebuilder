// Scope section CSS to one block at emit time. The stored text is left alone.
import type { CssList, CssNode } from 'css-tree'
import { CssRejected } from './errors'

const ROOT_TYPES = new Set(['html', 'body'])
const ANIMATION_PROPS = new Set(['animation', 'animation-name', '-webkit-animation', '-webkit-animation-name'])
const ANIMATION_KEYWORDS = new Set([
  'none',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'paused',
  'running',
  'step-start',
  'step-end',
])

interface WalkCtx {
  keyframes: boolean
  /** Style rules this node is nested inside. An `&` there means the parent selector. */
  styleDepth: number
}

function isList(value: unknown): value is CssList {
  return !!value && typeof value === 'object' && typeof (value as CssList).forEach === 'function' && typeof (value as CssList).prependData === 'function'
}

function nodeName(node: CssNode): string {
  if (typeof node.name === 'string') return node.name
  return ''
}

function locOf(node: CssNode | undefined): { line: number; column: number } {
  const line = node?.loc?.start?.line ?? 1
  const column = node?.loc?.start?.column ?? 1
  return { line: line > 0 ? line : 1, column: column > 0 ? column : 1 }
}

function isRootToken(node: CssNode): boolean {
  if (node.type === 'NestingSelector') return true
  if (node.type === 'PseudoClassSelector' && nodeName(node).toLowerCase() === 'root') return true
  if (node.type === 'TypeSelector' && ROOT_TYPES.has(nodeName(node).toLowerCase())) return true
  return false
}

interface PrefixScope {
  attribute: string
  value: string
  keyframePrefix: string
}

function attributeNode(scope: PrefixScope): CssNode {
  return {
    type: 'AttributeSelector',
    loc: null,
    name: { type: 'Identifier', name: scope.attribute },
    matcher: '=',
    value: { type: 'String', loc: null, value: scope.value },
    flags: null,
  }
}

function combinator(name: string): CssNode {
  return { type: 'Combinator', loc: null, name }
}

function outside(node: CssNode | undefined): never {
  const pos = locOf(node)
  throw new CssRejected(pos.line, pos.column, 'This selector would style outside the section.')
}

/** Prefix one selector. Does not walk into :is, :where, :not or :has. */
function prefixSelector(selector: CssNode, scope: PrefixScope, nested: boolean) {
  const kids = selector.children
  if (!isList(kids) || kids.size === 0) return
  const nodes: CssNode[] = []
  const items: unknown[] = []
  kids.forEach((node, item) => {
    nodes.push(node)
    items.push(item)
  })

  let compoundEnd = 0
  while (compoundEnd < nodes.length && nodes[compoundEnd]!.type !== 'Combinator') compoundEnd++
  const combinatorNode = nodes[compoundEnd]
  const root = compoundEnd > 0 && isRootToken(nodes[0]!)
  const nestingParent = nested && nodes[0]?.type === 'NestingSelector'

  if (root && combinatorNode && combinatorNode.type === 'Combinator' && combinatorNode.name !== ' ' && combinatorNode.name !== '>') {
    // `body + .next` would become a sibling of the section. A nested `&` is the parent selector, which is already inside.
    if (!nestingParent) outside(nodes[0])
  }
  if (nestingParent) return

  if (root && !combinatorNode) {
    kids.remove(items[0])
    if (compoundEnd > 1) kids.insertData(attributeNode(scope), items[1])
    else kids.prependData(attributeNode(scope))
    return
  }
  if (root && combinatorNode && (combinatorNode.name === ' ' || combinatorNode.name === '>')) {
    kids.remove(items[0])
    if (compoundEnd === 1) kids.prependData(attributeNode(scope))
    else kids.insertData(attributeNode(scope), items[1])
    return
  }
  kids.prependData(combinator(' '))
  kids.prependData(attributeNode(scope))
}

function prefixRule(rule: CssNode, scope: PrefixScope, nested: boolean) {
  const prelude = rule.prelude
  const list = prelude?.children
  if (!isList(list)) return
  list.forEach((selector) => {
    if (selector.type === 'Selector') prefixSelector(selector, scope, nested)
  })
}

function renameKeyframe(atrule: CssNode, scope: PrefixScope) {
  const list = atrule.prelude?.children
  if (!isList(list)) return
  list.forEach((node) => {
    if ((node.type === 'Identifier' || node.type === 'Ident') && typeof node.name === 'string') node.name = `${scope.keyframePrefix}__${node.name}`
  })
}

function prefixAnimationValue(value: CssNode | string | null | undefined, scope: PrefixScope) {
  if (!value || typeof value === 'string' || !isList(value.children)) return
  value.children.forEach((child) => {
    if ((child.type !== 'Identifier' && child.type !== 'Ident') || typeof child.name !== 'string') return
    if (ANIMATION_KEYWORDS.has(child.name.toLowerCase())) return
    child.name = `${scope.keyframePrefix}__${child.name}`
  })
}

function visit(node: CssNode, ctx: WalkCtx, scope: PrefixScope) {
  const kids = node.children
  if (!isList(kids)) return
  kids.forEach((child) => {
    if (child.type === 'Rule') {
      if (!ctx.keyframes) prefixRule(child, scope, ctx.styleDepth > 0)
      if (child.block) visit(child.block, { keyframes: ctx.keyframes, styleDepth: ctx.keyframes ? ctx.styleDepth : ctx.styleDepth + 1 }, scope)
      return
    }
    if (child.type === 'Atrule') {
      const name = nodeName(child).toLowerCase()
      const inKeyframes = ctx.keyframes || name === 'keyframes'
      if (name === 'keyframes' && !ctx.keyframes) renameKeyframe(child, scope)
      if (child.block) visit(child.block, { keyframes: inKeyframes, styleDepth: ctx.styleDepth }, scope)
      return
    }
    if (child.type === 'Declaration') {
      const prop = (child.property ?? '').toLowerCase()
      if (ANIMATION_PROPS.has(prop) && child.value && typeof child.value !== 'string') prefixAnimationValue(child.value, scope)
    }
  })
}

/** Mutates the stylesheet: selectors, keyframe names and animation names. */
export function prefixSectionCss(
  ast: CssNode,
  sectionId: string,
  scope?: { attribute?: string; value?: string; keyframePrefix?: string },
) {
  const resolved: PrefixScope = {
    attribute: scope?.attribute ?? 'data-sb-css',
    value: scope?.value ?? sectionId,
    keyframePrefix: scope?.keyframePrefix ?? sectionId,
  }
  visit(ast, { keyframes: false, styleDepth: 0 }, resolved)
}
