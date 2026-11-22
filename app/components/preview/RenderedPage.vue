<script setup lang="ts">
// A page drawn by the real publish renderer (server/services/preview.ts), for the editor canvas and the approval
// preview. Two frames take turns so an update never flickers: the next HTML loads in the hidden one, then they swap.
// The frame is as tall as the page and scaled to fit, so the outer box scrolls and keeps its place between updates.
import type { PageDoc } from '#shared/page'
import { api, ApiError } from '../../utils/api'
import { canvasScale } from '../../utils/format'
import { mediaVersion } from '../../utils/media'
import { DEVICE_WIDTHS, type Device } from '../../utils/page-editor'

export type BlockMark = 'added' | 'changed' | 'issue'

const props = withDefaults(
  defineProps<{
    /** A page draft (the page editor and approvals). */
    doc?: PageDoc
    /** Or any other preview request, for example draft site parts on a live page (`/preview/site-part`). */
    endpoint?: string
    payload?: Record<string, unknown>
    device: Device
    pageId?: string
    path?: string
    selectedId?: string | null
    marks?: Record<string, BlockMark>
    /** Pixels kept free around the page inside the scroll box. */
    gutter?: number
    /** Sections can be clicked to select them (the editor). Off for read-only previews. */
    selectable?: boolean
  }>(),
  { selectedId: null, marks: () => ({}), gutter: 48, pageId: undefined, path: undefined, selectable: true, doc: undefined, endpoint: '/preview/render', payload: undefined },
)
const emit = defineEmits<{ select: [id: string | null]; rendered: [doc: Document]; meta: [meta: Record<string, unknown>] }>()

const host = ref<HTMLElement | null>(null)
const frameA = ref<HTMLIFrameElement | null>(null)
const frameB = ref<HTMLIFrameElement | null>(null)
const frameEls = [frameA, frameB]
const front = ref(0)
const heights = reactive([800, 800])
const available = ref(1280)
const error = ref('')
const ready = ref(false)
const width = computed(() => DEVICE_WIDTHS[props.device])
const scale = computed(() => canvasScale(Math.max(available.value - props.gutter, 160), width.value))
const height = computed(() => heights[front.value]!)

const STYLE = `
.sb-selectable [data-block-id]{cursor:pointer;transition:outline-color .15s}
.sb-selectable [data-block-id]:hover{outline:2px dashed rgba(37,99,235,.55);outline-offset:-2px}
[data-block-id].sb-added{outline:3px solid #10b981;outline-offset:-3px}
[data-block-id].sb-changed{outline:3px solid #f59e0b;outline-offset:-3px}
[data-block-id].sb-issue{outline:3px solid #dc2626;outline-offset:-3px}
[data-block-id].sb-selected{outline:3px solid #2563eb !important;outline-offset:-3px}
`

let observer: ResizeObserver | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let again = false

function measureHost() {
  available.value = host.value?.clientWidth ?? 1280
}

async function render() {
  if (inFlight) {
    again = true
    return
  }
  inFlight = true
  try {
    const body = props.payload ? toRaw(props.payload) : { doc: toRaw(props.doc), pageId: props.pageId, path: props.path }
    const { html, ...meta } = await api<{ html: string } & Record<string, unknown>>(props.endpoint, { method: 'POST', body })
    error.value = ''
    emit('meta', meta)
    const frame = frameEls[1 - front.value]!.value
    if (frame) frame.srcdoc = html
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'The preview could not be updated.'
  } finally {
    inFlight = false
    if (again) {
      again = false
      void render()
    }
  }
}

function schedule(delay = 250) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void render(), delay)
}

function docOf(i: number): Document | null {
  try {
    return frameEls[i]!.value?.contentDocument ?? null
  } catch {
    return null
  }
}

function applyMarks(doc: Document | null) {
  if (!doc) return
  for (const el of doc.querySelectorAll<HTMLElement>('[data-block-id]')) {
    const id = el.dataset.blockId!
    const mark = props.marks[id]
    el.classList.toggle('sb-added', mark === 'added')
    el.classList.toggle('sb-changed', mark === 'changed')
    el.classList.toggle('sb-issue', mark === 'issue')
    el.classList.toggle('sb-selected', id === props.selectedId)
  }
}

/** header.js does not run in the sandboxed frame. Match it at scroll position 0, from the parent, with no eval. */
function applySeeThroughHeader(doc: Document) {
  const over = doc.querySelector<HTMLElement>('.site-header-over')
  const first = doc.querySelector('main > :first-child')
  if (!over || !first || !/ hero /.test(` ${first.getAttribute('class') ?? ''} `)) return
  over.classList.add('js-over')
  const strip = doc.querySelector<HTMLElement>('.banner')
  const gap = strip ? Math.max(0, Math.round(strip.getBoundingClientRect().bottom)) : 0
  over.style.setProperty('--strip', `${gap}px`)
  doc.documentElement.style.setProperty('--sb-header-h', `${Math.round(over.getBoundingClientRect().height)}px`)
}

function onLoad(i: number) {
  const frame = frameEls[i]!.value
  const doc = docOf(i)
  if (!frame?.srcdoc || !doc?.body) return
  applySeeThroughHeader(doc)
  const style = doc.createElement('style')
  style.textContent = STYLE
  doc.head.appendChild(style)
  doc.documentElement.classList.toggle('sb-selectable', props.selectable)
  // Links and forms would load builder pages inside the frame. A click on a section selects it.
  doc.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null
      if (target?.closest('a[href]')) e.preventDefault()
      const block = target?.closest<HTMLElement>('[data-block-id]')
      if (block && props.selectable) emit('select', block.dataset.blockId!)
    },
    true,
  )
  doc.addEventListener('submit', (e) => e.preventDefault(), true)
  applyMarks(doc)
  const size = () => {
    heights[i] = Math.max(200, doc.documentElement.scrollHeight)
  }
  size()
  observer?.disconnect()
  observer = new ResizeObserver(size)
  observer.observe(doc.body)
  front.value = i
  ready.value = true
  emit('rendered', doc)
}

/** Scroll the outer box so a section is in view (used when it is picked in the outline or the review list). */
function scrollToBlock(id: string, smooth = true) {
  const el = docOf(front.value)?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
  const box = host.value
  const stage = frameEls[front.value]!.value?.parentElement?.parentElement
  if (!el || !box || !stage) return
  const top = stage.offsetTop + el.offsetTop * scale.value
  const bottom = top + el.offsetHeight * scale.value
  if (top >= box.scrollTop && bottom <= box.scrollTop + box.clientHeight) return
  box.scrollTo({ top: Math.max(0, top - 24), behavior: smooth ? 'smooth' : 'auto' })
}
/** Scroll the outer box to an element of the page (the footer, say). */
function scrollToSelector(selector: string, smooth = true) {
  const el = docOf(front.value)?.querySelector<HTMLElement>(selector)
  const box = host.value
  const stage = frameEls[front.value]!.value?.parentElement?.parentElement
  if (!el || !box || !stage) return
  box.scrollTo({ top: Math.max(0, stage.offsetTop + el.offsetTop * scale.value - 24), behavior: smooth ? 'smooth' : 'auto' })
}
const frameDocument = () => docOf(front.value)
defineExpose({ scrollToBlock, scrollToSelector, frameDocument })

watch(() => [props.doc, props.payload], () => schedule(), { deep: true })
watch(() => [props.pageId, props.path, mediaVersion.value], () => schedule(0))
watch(() => [props.selectedId, props.marks], () => applyMarks(docOf(front.value)), { deep: true })
watch(
  () => props.selectedId,
  (id) => id && nextTick(() => scrollToBlock(id)),
)
watch(width, () =>
  nextTick(() => {
    const doc = docOf(front.value)
    if (doc) heights[front.value] = Math.max(200, doc.documentElement.scrollHeight)
  }),
)

onMounted(() => {
  measureHost()
  const ro = new ResizeObserver(measureHost)
  if (host.value) ro.observe(host.value)
  onBeforeUnmount(() => {
    ro.disconnect()
    observer?.disconnect()
    if (timer) clearTimeout(timer)
  })
  void render()
})
</script>

<template>
  <div ref="host" class="relative min-h-0 min-w-0 flex-1 overflow-auto" data-rendered-page>
    <p v-if="scale < 1" class="pointer-events-none sticky top-2 z-10 m-0 flex justify-center"><span class="rounded-full bg-gray-900/70 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">{{ Math.round(scale * 100) }}%</span></p>
    <p v-if="error" class="sticky top-0 z-10 m-0 border-b border-amber-300 bg-amber-50 px-4 py-1 text-center text-xs text-amber-900" role="status">{{ error }} Showing the last version that could be drawn.</p>
    <slot name="above" />
    <div class="flex justify-center p-6" @click.self="emit('select', null)">
      <div class="relative overflow-hidden rounded-lg shadow-xl ring-1 ring-gray-900/5" :style="{ width: `${width * scale}px`, height: `${height * scale}px` }">
        <div class="absolute left-0 top-0 origin-top-left" :style="{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }">
          <iframe
            ref="frameA"
            sandbox="allow-same-origin"
            :title="front === 0 ? 'Page preview' : 'Next page preview'"
            :aria-hidden="front === 0 ? undefined : 'true'"
            :tabindex="front === 0 ? undefined : -1"
            class="absolute left-0 top-0 block border-0 bg-white"
            :class="front === 0 && ready ? 'visible' : 'invisible'"
            :style="{ width: `${width}px`, height: `${heights[0]}px` }"
            :data-front="front === 0 ? '' : undefined"
            @load="onLoad(0)"
          />
          <iframe
            ref="frameB"
            sandbox="allow-same-origin"
            :title="front === 1 ? 'Page preview' : 'Next page preview'"
            :aria-hidden="front === 1 ? undefined : 'true'"
            :tabindex="front === 1 ? undefined : -1"
            class="absolute left-0 top-0 block border-0 bg-white"
            :class="front === 1 && ready ? 'visible' : 'invisible'"
            :style="{ width: `${width}px`, height: `${heights[1]}px` }"
            :data-front="front === 1 ? '' : undefined"
            @load="onLoad(1)"
          />
        </div>
      </div>
    </div>
    <p v-if="!ready && !error" class="absolute inset-x-0 top-16 m-0 text-center text-sm text-gray-500">Drawing the page…</p>
    <slot name="below" />
  </div>
</template>
