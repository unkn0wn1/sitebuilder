<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { Device, PageEditor } from '../../utils/page-editor'
import type { FieldIssue } from '#shared/issues'
import { blockIndexFromPath, describeIssues, issuesUnder } from '#shared/field-issues'
import { blockCatalog, blockLabel } from '../../utils/block-fields'

const props = defineProps<{ editor: PageEditor }>()
const emit = defineEmits<{ submitted: [] }>()

const assistant = useAssistant(() => props.editor)

const submitting = ref(false)
const submitError = ref('')
const submitIssues = ref<FieldIssue[]>([])
// Problems from the submit check, plus any field the last save was turned down for.
const shownIssues = computed(() => [...props.editor.saveIssues, ...submitIssues.value])
const showMobileFields = ref(false)
const showMobileRail = ref(false)

const blockLabels = computed(() => Object.fromEntries(blockCatalog().map((item) => [item.type, item.label])))
const labelledIssues = computed(() =>
  describeIssues(submitIssues.value, {
    blockTypes: props.editor.doc.blocks.map((block) => block.type),
    blockLabels: blockLabels.value,
  }),
)

function issuePathFor(blockId: string): string {
  const index = props.editor.doc.blocks.findIndex((block) => block.id === blockId)
  return index >= 0 ? `blocks.${index}` : ''
}

function issuesForBlock(blockId: string): FieldIssue[] {
  const path = issuePathFor(blockId)
  return path ? issuesUnder(submitIssues.value, path) : []
}

function onSectionProps(value: Record<string, unknown>) {
  const id = props.editor.selectedId
  if (id) props.editor.updateProps(id, value)
}

function focusIssue(issue: FieldIssue) {
  const index = blockIndexFromPath(issue.path)
  if (index == null) {
    props.editor.setInspectorTab('page')
    showMobileFields.value = true
    return
  }
  const block = props.editor.doc.blocks[index]
  if (block) props.editor.select(block.id)
  showMobileFields.value = true
  void nextTick(() => {
    const field = document.querySelector(`[data-field-path="${CSS.escape(issue.path)}"]`)
    const section = block ? document.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`) : null
    ;(field ?? section)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

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
  submitIssues.value = []
  submitting.value = true
  try {
    if (!(await props.editor.flushAll())) {
      submitError.value = props.editor.conflict
        ? 'Sort out the conflict above before submitting, so the approver sees your latest changes.'
        : 'Some changes are not saved yet, so they would not be in what the approver sees. Check your connection and try again.'
      return
    }
    await api(`/pages/${props.editor.pageId}/submit`, { method: 'POST', body: {} })
    emit('submitted')
  } catch (error) {
    if (error instanceof ApiError) {
      submitError.value = error.message
      const fields = error.details.fields
      submitIssues.value = Array.isArray(fields) ? (fields as FieldIssue[]) : []
      if (submitIssues.value[0]) focusIssue(submitIssues.value[0]!)
    } else {
      submitError.value = 'Could not submit this page.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex h-[calc(100dvh-3.25rem)] min-h-0 min-w-0 flex-col md:h-[calc(100vh-3.25rem)]">
    <header class="flex min-w-0 flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 sm:gap-3 sm:px-4">
      <NuxtLink to="/pages" class="text-sm text-gray-600 dark:text-gray-400 no-underline hover:underline">&lt; Pages</NuxtLink>
      <h1 class="m-0 min-w-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{{ editor.title }}</h1>
      <BuilderStatusBadge :state="editor.state" :has-unpublished-changes="editor.hasUnpublishedChanges" />
      <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="save-status">{{ saveLabel }}</span>
      <div class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <div class="md:hidden"><FwbButton size="sm" color="light" data-testid="mobile-sections" @click="showMobileRail = true">Sections</FwbButton></div>
        <div v-if="editor.selected" class="lg:hidden"><FwbButton size="sm" color="light" data-testid="mobile-edit-fields" @click="showMobileFields = true">Edit fields</FwbButton></div>
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
    <div v-if="submitError || editor.error || labelledIssues.length" class="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-50" data-testid="submit-issues">
      <p class="m-0 font-medium">{{ submitError || editor.error || 'Fix these before submitting.' }}</p>
      <ul v-if="labelledIssues.length" class="mt-2 mb-0 list-disc space-y-2 pl-5">
        <li v-for="(item, i) in labelledIssues" :key="`${item.issue.path}-${i}`">
          <button type="button" class="text-left underline decoration-red-400 underline-offset-2 hover:decoration-red-700" @click="focusIssue(item.issue)">
            <span class="font-medium">{{ item.title }}.</span> {{ item.message }}
          </button>
        </li>
      </ul>
    </div>
    <div
      v-if="showMobileFields && editor.selected"
      class="max-h-[50vh] overflow-y-auto border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 lg:hidden"
      data-testid="mobile-section-fields"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <p class="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{{ blockLabel(editor.selected.type) }}</p>
        <button type="button" class="text-sm text-gray-600 dark:text-gray-400 hover:underline" @click="showMobileFields = false">Close</button>
      </div>
      <EditorSectionFields
        :type="editor.selected.type"
        :model-value="editor.selected.props"
        :issues="issuesForBlock(editor.selected.id)"
        :base-path="`${issuePathFor(editor.selected.id)}.props`"
        @update:model-value="onSectionProps"
      />
    </div>
    <div v-if="editor.offline" class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      You're offline. Your changes will save when you're back.
    </div>
    <EditorConflictBanner v-if="editor.conflict" :editor="editor" />
    <div class="relative flex min-h-0 min-w-0 flex-1">
      <div v-if="showMobileRail" class="fixed inset-0 z-30 bg-black/40 md:hidden" data-testid="mobile-rail-backdrop" @click="showMobileRail = false" />
      <EditorLeftRail v-if="showMobileRail" :editor="editor" :assistant="assistant" overlay @close="showMobileRail = false" />
      <EditorLeftRail class="max-md:hidden" :editor="editor" :assistant="assistant" />
      <EditorCanvas :editor="editor" :issues="shownIssues" />
      <EditorInspectorPanel :editor="editor" :issues="shownIssues" />
    </div>
  </div>
</template>
