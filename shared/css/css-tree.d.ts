/** Minimal types. css-tree 3.2.1 does not ship its own. */
declare module 'css-tree' {
  export interface CssPosition {
    line: number
    column: number
    offset: number
  }

  export interface CssNode {
    type: string
    loc?: { start: CssPosition; end: CssPosition } | null
    name?: string | { type: string; name: string }
    value?: string | CssNode
    property?: string
    matcher?: string | null
    flags?: string | null
    children?: CssList | CssNode[] | null
    prelude?: CssNode | null
    block?: CssNode | null
    important?: boolean
  }

  export interface CssList {
    first: CssNode | null
    size: number
    toArray(): CssNode[]
    forEach(fn: (node: CssNode, item: unknown, list: CssList) => void): void
    prependData(node: CssNode): CssList
    insertData(node: CssNode, before: unknown): CssList
    remove(item: unknown): CssNode | null
  }

  export function parse(source: string, options?: { positions?: boolean }): CssNode
  export function generate(ast: CssNode): string
  export function walk(ast: CssNode, fn: (node: CssNode) => void): void
}
