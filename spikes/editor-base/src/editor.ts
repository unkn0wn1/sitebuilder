// A minimal Vue editor on top of our page document and ops.
// Purpose: see whether a first-party canvas is enough, or whether we should start from Gissen or Page Composer.
import { computed, defineComponent, h, ref } from 'vue'
import { applyOps, type Op } from '../../../shared/ops'
import { createDefaultRegistry } from '../../../shared/blocks/registry'
import { sampleDoc, sampleMeta } from './sample'

const WIDTHS = { Desktop: 1280, Tablet: 768, Mobile: 390 } as const
type Device = keyof typeof WIDTHS

const registry = createDefaultRegistry()

export const EditorApp = defineComponent({
  name: 'EditorApp',
  setup() {
    const doc = ref(structuredClone(sampleDoc))
    const meta = ref(structuredClone(sampleMeta))
    const selectedId = ref<string | null>(doc.value.blocks[0]?.id ?? null)
    const device = ref<Device>('Desktop')

    function apply(ops: Op[]) {
      const result = applyOps({ doc: doc.value, meta: meta.value }, ops, { registry, newBlockId: () => `b_${Math.random().toString(36).slice(2, 10)}` })
      doc.value = result.state.doc
      meta.value = result.state.meta
    }

    const selected = computed(() => doc.value.blocks.find((b) => b.id === selectedId.value) ?? null)

    function move(delta: number) {
      const id = selectedId.value
      if (!id) return
      const from = doc.value.blocks.findIndex((b) => b.id === id)
      apply([{ op: 'move_block', blockId: id, toIndex: from + delta }])
    }

    function onHeadingInput(id: string, ev: Event) {
      const text = (ev.target as HTMLElement).innerText.trim()
      const block = doc.value.blocks.find((b) => b.id === id)
      if (!block) return
      const key = headingKey(block.type)
      if (!key) return
      apply([{ op: 'update_props', blockId: id, props: { [key]: text } }])
    }

    return () =>
      h('div', { class: 'shell' }, [
        h('header', { class: 'top' }, [
          h('strong', 'Editor base spike'),
          h('span', { class: 'muted' }, doc.value.title),
          h(
            'div',
            { class: 'devices' },
            (Object.keys(WIDTHS) as Device[]).map((d) =>
              h('button', { type: 'button', class: device.value === d ? 'on' : '', onClick: () => (device.value = d) }, d),
            ),
          ),
        ]),
        h('aside', { class: 'rail' }, [
          h('h2', 'Outline'),
          h(
            'ol',
            doc.value.blocks.map((b) =>
              h('li', [
                h(
                  'button',
                  { type: 'button', class: b.id === selectedId.value ? 'on' : '', onClick: () => (selectedId.value = b.id) },
                  `${label(b.type)}`,
                ),
              ]),
            ),
          ),
        ]),
        h('div', { class: 'canvas-wrap' }, [
          h(
            'div',
            { class: 'canvas', style: { width: `${WIDTHS[device.value]}px` } },
            doc.value.blocks.map((b) =>
              h(
                'section',
                {
                  class: ['block', b.id === selectedId.value ? 'selected' : ''].join(' '),
                  onClick: () => (selectedId.value = b.id),
                },
                [
                  h('p', { class: 'kind' }, label(b.type)),
                  headingKey(b.type)
                    ? h(
                        'h2',
                        { contenteditable: 'true', onBlur: (ev: Event) => onHeadingInput(b.id, ev) },
                        String(b.props[headingKey(b.type)!] ?? ''),
                      )
                    : null,
                  b.type === 'Quote' ? h('p', { class: 'quote' }, String(b.props.text ?? '')) : null,
                  b.type === 'Hero' && b.props.subheading ? h('p', String(b.props.subheading)) : null,
                ],
              ),
            ),
          ),
        ]),
        h('aside', { class: 'inspector' }, [
          h('h2', 'Section'),
          selected.value
            ? [
                h('p', label(selected.value.type)),
                h('div', { class: 'row' }, [
                  h('button', { type: 'button', onClick: () => move(-1) }, 'Move up'),
                  h('button', { type: 'button', onClick: () => move(1) }, 'Move down'),
                ]),
              ]
            : h('p', { class: 'muted' }, 'Select a section.'),
        ]),
      ])
  },
})

function headingKey(type: string): string | null {
  if (['Hero', 'RichText', 'CallToAction', 'FAQ', 'Stats', 'CardGrid', 'Gallery'].includes(type)) return 'heading'
  return null
}

function label(type: string): string {
  return registry.get(type)?.label ?? type
}
