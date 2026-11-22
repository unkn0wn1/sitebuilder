<script setup lang="ts">
import type { LiveCss } from '#shared/css/buffer'

const props = defineProps<{
  scope: 'section' | 'site'
  /** Present for a section. Site CSS has no section id. */
  sectionId?: string
  /** The text stored on the section or the brand. The hint is not part of this. */
  saved: string
}>()

const emit = defineEmits<{
  /** Author text to store. An empty string clears the field. Invalid text is never emitted. */
  save: [css: string]
  /** Valid section CSS for the live preview, or null when there is nothing to inject. */
  preview: [live: LiveCss | null]
}>()

const SECTION_HINT = 'Applies only inside this section. To style the section itself, start a selector with &.'
const SITE_HINT = 'Applies to the whole site, after the theme. A section can still override it.'
const SECTION_SNIPPETS = ['& { background: #f6f1ea; }', '.wrap { padding-block: 4rem; }']
const SITE_SNIPPETS = ['a { text-underline-offset: 0.15em; }']

const buffer = ref(props.saved)
const error = ref('')
const fullscreen = ref(false)
const confirming = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const fieldId = useId()
const errorId = useId()
const hintId = useId()
const discardTitleId = useId()
let generation = 0

const hint = computed(() => (props.scope === 'section' ? SECTION_HINT : SITE_HINT))
const snippets = computed(() => (props.scope === 'section' ? SECTION_SNIPPETS : SITE_SNIPPETS))

function grow() {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

async function assess() {
  const gen = ++generation
  const value = buffer.value
  const { assessCssBuffer } = await import('#shared/css/buffer')
  if (gen !== generation) return
  const result = assessCssBuffer({ buffer: value, saved: props.saved, scope: props.scope, sectionId: props.sectionId })
  error.value = result.error ?? ''
  if (result.live) emit('preview', result.live)
  else emit('preview', null)
  if (result.save !== null) emit('save', result.save)
}

function insert(snippet: string) {
  buffer.value = buffer.value.trim() ? `${buffer.value.replace(/\s+$/, '')}\n${snippet}` : snippet
}

function beforeClose() {
  if (buffer.value === props.saved) return true
  confirming.value = true
  return false
}

function discard() {
  confirming.value = false
  fullscreen.value = false
  buffer.value = props.saved
}

watch(buffer, () => {
  void nextTick(grow)
  void assess()
})

watch(
  () => props.saved,
  (next) => {
    if (confirming.value || error.value) return
    if (buffer.value !== next) buffer.value = next
  },
)

watch(
  () => props.sectionId,
  () => {
    confirming.value = false
    error.value = ''
    if (buffer.value !== props.saved) buffer.value = props.saved
    else void assess()
  },
)

onMounted(() => void nextTick(grow))
onBeforeUnmount(() => emit('preview', null))
</script>

<template>
  <div>
    <p :id="hintId" class="m-0 text-sm text-gray-600 dark:text-gray-400">{{ hint }}</p>
    <label :for="fieldId" class="mt-3 mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">CSS</label>
    <textarea
      :id="fieldId"
      ref="box"
      v-model="buffer"
      rows="6"
      spellcheck="false"
      class="block w-full resize-none overflow-hidden rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : hintId"
    />
    <p v-if="error" :id="errorId" class="mt-1 text-sm text-red-700 dark:text-red-300" role="alert">{{ error }}</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-for="snippet in snippets"
        :key="snippet"
        type="button"
        class="rounded border border-gray-300 px-2 py-1 font-mono text-xs text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        @click="insert(snippet)"
      >
        {{ snippet }}
      </button>
      <button type="button" class="rounded px-2 py-1 text-sm text-blue-700 hover:underline dark:text-blue-400" @click="fullscreen = true">Open full screen</button>
    </div>
    <FullscreenEditor v-model="buffer" v-model:open="fullscreen" title="Custom CSS" language="css" :before-close="beforeClose">
      <template v-if="$slots.preview" #aside>
        <slot name="preview" />
      </template>
    </FullscreenEditor>
    <div v-if="confirming" class="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/40 p-4">
      <div role="alertdialog" aria-modal="true" :aria-labelledby="discardTitleId" class="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-gray-800">
        <h2 :id="discardTitleId" class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Discard CSS changes?</h2>
        <p class="mt-2 text-sm text-gray-700 dark:text-gray-300">These changes are still in the field. They are not saved.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <FwbButton type="button" color="light" @click="confirming = false">Keep editing</FwbButton>
          <FwbButton type="button" color="red" @click="discard">Discard CSS changes</FwbButton>
        </div>
      </div>
    </div>
  </div>
</template>
