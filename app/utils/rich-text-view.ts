import { h, type VNode } from 'vue'
import type { RichTextDoc, RichTextNode, TextNode } from '#shared/richtext'
import { richTextToPlain } from '#shared/richtext'

export { richTextToPlain }

function marks(node: TextNode): VNode {
  let inner: VNode = h('span', node.text)
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') inner = h('strong', [inner])
    else if (mark.type === 'italic') inner = h('em', [inner])
    else if (mark.type === 'link') inner = h('a', { href: mark.href }, [inner])
  }
  return inner
}

function inline(nodes: TextNode[] | undefined): VNode[] {
  return (nodes ?? []).map((n) => marks(n))
}

export function richTextVNodes(doc: RichTextDoc | unknown): VNode[] {
  if (!doc || typeof doc !== 'object' || !('content' in doc)) return []
  const nodes = (doc as RichTextDoc).content ?? []
  return nodes.map((node) => renderNode(node))
}

function renderNode(node: RichTextNode): VNode {
  if (node.type === 'heading') return h(`h${node.level}`, inline(node.content))
  if (node.type === 'bulletList') return h('ul', node.content.map((item) => h('li', item.content.map((p) => h('p', inline(p.content))))))
  if (node.type === 'orderedList') return h('ol', node.content.map((item) => h('li', item.content.map((p) => h('p', inline(p.content))))))
  return h('p', inline(node.content))
}
