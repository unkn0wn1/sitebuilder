<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { PageEditor, type EditorSnapshot, type OpsResult } from '../../utils/page-editor'
import type { PageDoc } from '#shared/page'
import type { WorkflowState } from '#shared/workflow'
import type { TemplateRules } from '#shared/templates'
import type { PageMeta } from '#shared/ops'

definePageMeta({ layout: 'builder' })

interface PagePayload {
  page: {
    id: string
    title: string
    path: string
    slug: string
    parentId: string | null
    template: string
    workflowState: WorkflowState
    publishedVersionId: string | null
    draftVersionId: string | null
  }
  doc: PageDoc
  revision: number
  template: { key: string; label: string; rules: TemplateRules | null }
}

const route = useRoute()
const editor = shallowRef<PageEditor | null>(null)
const error = ref('')
const loading = ref(true)

const editorApi = {
  applyOps: (pageId: string, baseRevision: number, ops: Parameters<PageEditor['queue']>[0]) =>
    api<OpsResult>(`/pages/${pageId}/ops`, { method: 'POST', body: { baseRevision, ops } }),
  undo: (pageId: string, opId: string) => api<OpsResult>(`/pages/${pageId}/undo`, { method: 'POST', body: { opId } }),
}

function snapshotOf(data: PagePayload): EditorSnapshot {
  return {
    pageId: data.page.id,
    title: data.page.title,
    path: data.page.path,
    templateKey: data.template.key,
    templateLabel: data.template.label,
    state: data.page.workflowState,
    hasUnpublishedChanges: Boolean(data.page.publishedVersionId && data.page.draftVersionId !== data.page.publishedVersionId),
    doc: data.doc,
    revision: data.revision,
    meta: { slug: data.page.slug, parentId: data.page.parentId } satisfies PageMeta,
    rules: data.template.rules,
  }
}

async function load() {
  loading.value = true
  error.value = ''
  editor.value?.dispose()
  editor.value = null
  try {
    const data = await api<PagePayload>(`/pages/${route.params.id}`)
    const instance = new PageEditor(editorApi, snapshotOf(data), { storage: window.localStorage })
    // On a phone, show the page as a phone sees it rather than a desktop page scaled to a quarter.
    if (window.innerWidth < 768) instance.setDevice('mobile')
    editor.value = reactive(instance) as PageEditor
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "That page couldn't be opened."
  } finally {
    loading.value = false
  }
}

watch(() => route.params.id, load, { immediate: true })

onBeforeUnmount(() => {
  editor.value?.dispose()
})
</script>

<template>
  <div>
    <p v-if="loading" class="p-8 text-gray-500 dark:text-gray-400">Opening the page…</p>
    <FwbAlert v-else-if="error" type="danger" class="m-6">{{ error }}</FwbAlert>
    <EditorWorkspace v-else-if="editor" :editor="editor" @submitted="load" />
  </div>
</template>
