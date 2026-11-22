<script setup lang="ts">
import type { CodeMirrorHandle, EditorLanguage } from '../utils/codemirror'

const modelValue = defineModel<string>({ required: true })
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  title: string
  language: EditorLanguage
  readonly?: boolean
  /** Raw character cap. When set, the footer shows `n of maxLength` unless counterText replaces it. */
  maxLength?: number
  /** Replaces the raw counter line, so a caller can show a stripped count. */
  counterText?: string
  /**
   * Called for Exit and Escape. Return false to stay open (for example while a discard prompt is showing).
   * Callers that omit this close immediately, which is what the personality editor does.
   */
  beforeClose?: () => boolean
}>()

const titleId = useId()
const host = ref<HTMLElement | null>(null)
const docLength = ref(modelValue.value.length)

let generation = 0
let editor: CodeMirrorHandle | null = null
let closing = false
let restoreFocus: HTMLElement | null = null

const showCounter = computed(() => props.counterText !== undefined || props.maxLength !== undefined)
const counterLine = computed(() => props.counterText ?? `${docLength.value} of ${props.maxLength}`)

function requestClose() {
  if (closing || !open.value) return
  if (props.beforeClose && props.beforeClose() === false) return
  closing = true
  open.value = false
}

function destroyEditor() {
  editor?.destroy()
  editor = null
}

function giveFocusBack() {
  const back = restoreFocus
  restoreFocus = null
  if (back && document.contains(back)) back.focus()
}

async function mountEditor(gen: number) {
  await nextTick()
  if (gen !== generation || !open.value) return
  const parent = host.value
  if (!parent) return
  const { mountCodeMirror } = await import('../utils/codemirror')
  if (gen !== generation || !open.value || host.value !== parent) return
  destroyEditor()
  editor = mountCodeMirror({
    parent,
    value: modelValue.value,
    language: props.language,
    readonly: props.readonly,
    maxLength: props.maxLength,
    onChange(next) {
      docLength.value = next.length
      if (next !== modelValue.value) modelValue.value = next
    },
    onEscape: requestClose,
  })
  docLength.value = editor.length()
  editor.focus()
}

watch(
  open,
  (isOpen) => {
    if (!import.meta.client) return
    const gen = ++generation
    if (!isOpen) {
      destroyEditor()
      giveFocusBack()
      closing = false
      return
    }
    closing = false
    const active = document.activeElement
    restoreFocus = active instanceof HTMLElement ? active : null
    void mountEditor(gen)
  },
  { immediate: true },
)

watch(modelValue, (value) => {
  if (!editor) {
    docLength.value = value.length
    return
  }
  editor.setValue(value)
  docLength.value = editor.length()
})

onBeforeUnmount(() => {
  generation += 1
  destroyEditor()
  if (import.meta.client) giveFocusBack()
})
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-gray-900/40">
    <div
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown.esc.prevent="requestClose"
      class="flex h-full w-full flex-col bg-white dark:bg-gray-900"
    >
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h2 :id="titleId" class="m-0 min-w-0 truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h2>
        <FwbButton type="button" color="light" @click="requestClose">Exit full screen</FwbButton>
      </header>
      <div class="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref="host" class="min-h-0 min-w-0 flex-1"></div>
        <div v-if="$slots.aside" class="flex min-h-0 min-w-0 flex-1 flex-col border-t border-gray-200 dark:border-gray-700 md:border-l md:border-t-0">
          <slot name="aside" />
        </div>
      </div>
      <p v-if="showCounter" class="m-0 shrink-0 border-t border-gray-200 px-4 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        {{ counterLine }}
      </p>
    </div>
  </div>
</template>

<style scoped>
:deep(.cm-editor),
:deep(.cm-scroller) {
  height: 100%;
}
</style>
