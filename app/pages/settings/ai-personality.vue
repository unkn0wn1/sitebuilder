<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { SOUL_RAW_MAX, stripSoulComments } from '#shared/soul'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface SoulView {
  text: string
  defaultText: string
  strippedLength: number
  limit: number
  rawLimit: number
  isDefault: boolean
}

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const text = ref('')
const defaultText = ref('')
const fullscreen = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)

const counterText = computed(() => {
  const seen = stripSoulComments(text.value).length.toLocaleString('en-GB')
  return `${seen} of 48,000 characters the AI sees (comments not counted)`
})

function grow() {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function apply(view: SoulView) {
  text.value = view.text
  defaultText.value = view.defaultText
  void nextTick(grow)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    apply(await api<SoulView>('/settings/soul'))
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the personality.'
  } finally {
    loading.value = false
    void nextTick(grow)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  saved.value = ''
  try {
    apply(await api<SoulView>('/settings/soul', { method: 'PUT', body: { text: text.value } }))
    saved.value = 'Saved.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save the personality.'
  } finally {
    saving.value = false
  }
}

function reset() {
  text.value = defaultText.value
  saved.value = ''
  error.value = ''
  void nextTick(grow)
}

onMounted(load)
watch(text, () => void nextTick(grow))
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">AI personality</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-3xl text-gray-600 dark:text-gray-400">
      This is the voice the assistant uses. Comments in the text are notes for people. The assistant does not see them. It does not change who can publish.
    </p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading personality…</p>
    <form v-else class="max-w-3xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <label for="ai-personality" class="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100">Personality</label>
      <textarea
        id="ai-personality"
        ref="box"
        v-model="text"
        class="block w-full min-h-[70vh] resize-none overflow-hidden rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        @input="grow"
      />
      <p class="mt-2 mb-4 text-sm text-gray-600 dark:text-gray-400">{{ counterText }}</p>
      <div class="flex flex-wrap gap-2">
        <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
        <FwbButton type="button" color="light" :disabled="saving" @click="reset">Reset to default</FwbButton>
        <FwbButton type="button" color="light" :disabled="saving" @click="fullscreen = true">Full screen</FwbButton>
      </div>
    </form>
    <FullscreenEditor
      v-model="text"
      v-model:open="fullscreen"
      title="AI personality"
      language="markdown"
      :max-length="SOUL_RAW_MAX"
      :counter-text="counterText"
    />
  </div>
</template>
