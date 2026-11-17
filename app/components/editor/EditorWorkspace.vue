<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { Device, PageEditor } from '../../utils/page-editor'

const props = defineProps<{ editor: PageEditor }>()
const emit = defineEmits<{ submitted: [] }>()

const assistant = useAssistant(() => props.editor)

const submitting = ref(false)
const submitError = ref('')

const saveLabel = computed(() => {
  switch (props.editor.saveStatus) {
    case 'saving':
      return 'Saving…'
    case 'offline':
      return "You're offline"
    case 'conflict':
      return 'Conflict'
    case 'error':
      return 'Not saved'
    default:
      return 'Saved'
  }
})

const devices: { id: Device; label: string }[] = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'tablet', label: 'Tablet' },
  { id: 'mobile', label: 'Mobile' },
]

function onKey(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (!meta || event.key.toLowerCase() !== 'z') return
  const target = event.target as HTMLElement | null
  if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  event.preventDefault()
  if (event.shiftKey) props.editor.redo()
  else void props.editor.undo()
}

function onOnline() {
  props.editor.setOnline(true)
}
function onOffline() {
  props.editor.setOnline(false)
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  if (typeof navigator !== 'undefined' && !navigator.onLine) props.editor.setOnline(false)
  void assistant.refreshStatus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  void props.editor.flush()
  props.editor.dispose()
})

async function submit() {
  submitError.value = ''
  submitting.value = true
  try {
    await props.editor.flush()
    await api(`/pages/${props.editor.pageId}/submit`, { method: 'POST', body: {} })
    emit('submitted')
  } catch (error) {
    submitError.value = error instanceof ApiError ? error.message : 'Could not submit this page.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex h-[calc(100vh-3.25rem)] min-h-0 flex-col">
    <header class="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
      <NuxtLink to="/pages" class="text-sm text-gray-600 no-underline hover:underline">&lt; Pages</NuxtLink>
      <h1 class="m-0 text-base font-semibold text-gray-900">{{ editor.title }}</h1>
      <BuilderStatusBadge :state="editor.state" :has-unpublished-changes="editor.hasUnpublishedChanges" />
      <span class="text-sm text-gray-500" data-testid="save-status">{{ saveLabel }}</span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <FwbButtonGroup>
          <FwbButton
            v-for="device in devices"
            :key="device.id"
            size="sm"
            :color="editor.device === device.id ? 'default' : 'light'"
            @click="editor.setDevice(device.id)"
          >
            {{ device.label }}
          </FwbButton>
        </FwbButtonGroup>
        <FwbButton size="sm" color="light" :disabled="!editor.undoStack.length" @click="editor.undo()">Undo</FwbButton>
        <FwbButton size="sm" color="light" :disabled="!editor.redoStack.length" @click="editor.redo()">Redo</FwbButton>
        <FwbButton v-if="editor.canSubmit" size="sm" :disabled="submitting" @click="submit">
          {{ submitting ? 'Submitting…' : 'Submit for approval' }}
        </FwbButton>
      </div>
    </header>
    <FwbAlert v-if="submitError || editor.error" type="danger" class="rounded-none">{{ submitError || editor.error }}</FwbAlert>
    <div v-if="editor.offline" class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      You're offline. Your changes will save when you're back.
    </div>
    <EditorConflictBanner v-if="editor.conflict" :editor="editor" />
    <div class="flex min-h-0 flex-1">
      <EditorLeftRail :editor="editor" :assistant="assistant" />
      <EditorCanvas :editor="editor" />
      <EditorInspectorPanel :editor="editor" />
    </div>
  </div>
</template>
