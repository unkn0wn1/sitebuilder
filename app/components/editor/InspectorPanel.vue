<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import type { InspectorTab, PageEditor } from '../../utils/page-editor'
import type { FieldIssue } from '#shared/issues'
import type { LiveCss } from '#shared/css/buffer'
import { can } from '#shared/roles'
import CssEditor from '../css/CssEditor.vue'
import RenderedPage from '../preview/RenderedPage.vue'

const props = withDefaults(defineProps<{ editor: PageEditor; issues?: FieldIssue[] }>(), { issues: () => [] })

const { user } = useSession()
const canCss = computed(() => !!user.value && can(user.value, 'design.css'))

function onCssSave(css: string) {
  const id = props.editor.selected?.id
  if (id) props.editor.setBlockCss(id, css)
}

function onCssPreview(live: LiveCss | null) {
  props.editor.cssPreview = live
}

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
  <aside class="hidden h-full w-80 min-h-0 flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 lg:flex">
    <div class="flex border-b border-gray-200 dark:border-gray-700 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-1 rounded-md px-2 py-2 text-sm"
        :class="editor.inspectorTab === tab.id ? 'bg-gray-100 dark:bg-gray-800 font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'"
        :disabled="tab.id === 'section' && !editor.selected"
        @click="editor.setInspectorTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <p v-if="editor.inspectorTab === 'section' && !editor.selected" class="text-sm text-gray-500 dark:text-gray-400">Select a section to edit its fields.</p>
      <div v-else-if="editor.inspectorTab === 'section' && editor.selected">
                <EditorSectionFields
          :type="editor.selected.type"
          :model-value="editor.selected.props"
          :issues="issues"
          :base-path="`blocks.${editor.doc.blocks.findIndex((b) => b.id === editor.selected!.id)}.props`"
          @update:model-value="onProps"
        />
        <details v-if="canCss" class="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700" data-testid="custom-css">
          <summary class="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">Custom CSS</summary>
          <CssEditor class="mt-3" scope="section" :section-id="editor.selected.id" :saved="editor.selected.css ?? ''" @save="onCssSave" @preview="onCssPreview">
            <template #preview>
              <RenderedPage
                :doc="editor.doc"
                :device="editor.device"
                :page-id="editor.pageId"
                :path="editor.path"
                :selected-id="editor.selectedId"
                :live-css="editor.cssPreview"
                @select="(id) => editor.select(id)"
              />
            </template>
          </CssEditor>
        </details>
        <div class="mt-6 flex flex-col gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
          <FwbButton color="light" size="sm" @click="editor.duplicateSection(editor.selected.id)">Duplicate</FwbButton>
          <FwbButton color="red" size="sm" @click="editor.removeSection(editor.selected.id)">Remove section</FwbButton>
        </div>
      </div>

      <div v-else-if="editor.inspectorTab === 'page'" class="flex flex-col gap-4">
        <FwbInput :model-value="editor.doc.title" label="Title" @update:model-value="editor.setMeta({ title: String($event) })" />
        <FwbInput :model-value="editor.meta.slug" label="Address" @update:model-value="editor.setMeta({ slug: String($event) })" />
        <p class="text-sm text-gray-500 dark:text-gray-400">Page type: {{ editor.templateLabel }}</p>
        <FwbInput :model-value="editor.doc.seo.title ?? ''" label="Search title" @update:model-value="editor.setSeo({ title: String($event) || null })" />
        <FwbTextarea :model-value="editor.doc.seo.description ?? ''" label="Search description" @update:model-value="editor.setSeo({ description: String($event) || null })" />
        <label class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
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
          <li v-for="item in versions" :key="item.id" class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-3">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ item.summary || kindLabel[item.kind] || item.kind }}
              <span v-if="item.isLive" class="ml-1 text-green-700">Live</span>
              <span v-else-if="item.isDraft" class="ml-1 text-gray-500 dark:text-gray-400">Current</span>
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ timeAgo(item.createdAt) }}</p>
            <button v-if="!item.isDraft" type="button" class="mt-1 text-xs text-blue-700 dark:text-blue-400 hover:underline" @click="restore(item.id)">Restore this version</button>
          </li>
        </ol>
      </div>
    </div>
  </aside>
</template>
