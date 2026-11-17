<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import type { InspectorTab, PageEditor } from '../../utils/page-editor'

const props = defineProps<{ editor: PageEditor }>()

const tabs: { id: InspectorTab; label: string }[] = [
  { id: 'section', label: 'Section' },
  { id: 'page', label: 'Page' },
  { id: 'history', label: 'History' },
]

interface VersionItem {
  id: string
  number: number
  kind: string
  summary: string | null
  sealed: boolean
  createdAt: string
  isLive: boolean
  isDraft: boolean
}

const versions = ref<VersionItem[]>([])
const versionError = ref('')
const versionName = ref('')
const savingVersion = ref(false)

const kindLabel: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  autosave: 'Autosave',
  checkpoint: 'Saved version',
  submitted: 'Submitted',
  restored: 'Restored',
  ai: 'Assistant',
  published: 'Live',
}

async function loadVersions() {
  versionError.value = ''
  try {
    const data = await api<{ items: VersionItem[] }>(`/pages/${props.editor.pageId}/versions`)
    versions.value = data.items
  } catch (error) {
    versionError.value = error instanceof ApiError ? error.message : 'Could not load history.'
  }
}

watch(
  () => props.editor.inspectorTab,
  (tab) => {
    if (tab === 'history') void loadVersions()
  },
  { immediate: true },
)

watch(
  () => props.editor.revision,
  () => {
    if (props.editor.inspectorTab === 'history') void loadVersions()
  },
)

function onProps(next: Record<string, unknown>) {
  const block = props.editor.selected
  if (!block) return
  props.editor.updateProps(block.id, next)
}

async function saveVersion() {
  const summary = versionName.value.trim()
  if (!summary) return
  savingVersion.value = true
  try {
    await props.editor.flush()
    await api(`/pages/${props.editor.pageId}/checkpoint`, { method: 'POST', body: { summary } })
    versionName.value = ''
    await loadVersions()
  } catch (error) {
    versionError.value = error instanceof ApiError ? error.message : 'Could not save that version.'
  } finally {
    savingVersion.value = false
  }
}

async function restore(id: string) {
  try {
    await props.editor.flush()
    const data = await api<{ revision: number; doc: typeof props.editor.doc }>(`/pages/${props.editor.pageId}/versions/${id}/restore`, { method: 'POST', body: {} })
    props.editor.doc = data.doc
    props.editor.revision = data.revision
    props.editor.title = data.doc.title
    await loadVersions()
  } catch (error) {
    versionError.value = error instanceof ApiError ? error.message : 'Could not restore that version.'
  }
}
</script>

<template>
  <aside v-if="editor.selected || editor.inspectorTab !== 'section'" class="flex h-full w-80 min-h-0 flex-col border-l border-gray-200 bg-white">
    <div class="flex border-b border-gray-200 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-1 rounded-md px-2 py-2 text-sm"
        :class="editor.inspectorTab === tab.id ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-600 hover:bg-gray-50'"
        :disabled="tab.id === 'section' && !editor.selected"
        @click="editor.setInspectorTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <div v-if="editor.inspectorTab === 'section' && editor.selected">
        <EditorSectionFields :type="editor.selected.type" :model-value="editor.selected.props" @update:model-value="onProps" />
        <div class="mt-6 flex flex-col gap-2 border-t border-gray-200 pt-4">
          <FwbButton color="light" size="sm" @click="editor.duplicateSection(editor.selected.id)">Duplicate</FwbButton>
          <FwbButton color="red" size="sm" @click="editor.removeSection(editor.selected.id)">Remove section</FwbButton>
        </div>
      </div>

      <div v-else-if="editor.inspectorTab === 'page'" class="flex flex-col gap-4">
        <FwbInput :model-value="editor.doc.title" label="Title" @update:model-value="editor.setMeta({ title: String($event) })" />
        <FwbInput :model-value="editor.meta.slug" label="Address" @update:model-value="editor.setMeta({ slug: String($event) })" />
        <p class="text-sm text-gray-500">Page type: {{ editor.templateLabel }}</p>
        <FwbInput :model-value="editor.doc.seo.title ?? ''" label="Search title" @update:model-value="editor.setSeo({ title: String($event) || null })" />
        <FwbTextarea :model-value="editor.doc.seo.description ?? ''" label="Search description" @update:model-value="editor.setSeo({ description: String($event) || null })" />
        <label class="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" :checked="editor.doc.seo.noindex" @change="editor.setSeo({ noindex: ($event.target as HTMLInputElement).checked })">
          Hide from search engines
        </label>
      </div>

      <div v-else-if="editor.inspectorTab === 'history'">
        <div class="mb-4">
          <FwbInput v-model="versionName" label="Save a version" placeholder="Before I try something" />
          <FwbButton class="mt-2" size="sm" :disabled="savingVersion || !versionName.trim()" @click="saveVersion">Save a version</FwbButton>
        </div>
        <FwbAlert v-if="versionError" type="danger" class="mb-3">{{ versionError }}</FwbAlert>
        <ol class="m-0 list-none p-0">
          <li v-for="item in versions" :key="item.id" class="mb-3 border-b border-gray-100 pb-3">
            <p class="text-sm font-medium text-gray-900">
              {{ item.summary || kindLabel[item.kind] || item.kind }}
              <span v-if="item.isLive" class="ml-1 text-green-700">Live</span>
              <span v-else-if="item.isDraft" class="ml-1 text-gray-500">Current</span>
            </p>
            <p class="text-xs text-gray-500">{{ timeAgo(item.createdAt) }}</p>
            <button v-if="!item.isDraft" type="button" class="mt-1 text-xs text-blue-700 hover:underline" @click="restore(item.id)">Restore this version</button>
          </li>
        </ol>
      </div>
    </div>
  </aside>
</template>
