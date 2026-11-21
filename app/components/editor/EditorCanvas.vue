<script setup lang="ts">
// The editor's middle area: the page as the publish renderer draws it (RenderedPage), with the selected section's
// actions in a bar above it. Click a section in the page to select it; edit it in the panel on the right.
import type { PageEditor } from '../../utils/page-editor'
import type { FieldIssue } from '#shared/issues'
import { issuesUnder } from '#shared/field-issues'
import { blockLabel } from '../../utils/block-fields'
import RenderedPage, { type BlockMark } from '../preview/RenderedPage.vue'

const props = withDefaults(defineProps<{ editor: PageEditor; issues?: FieldIssue[] }>(), { issues: () => [] })

const marks = computed(() => {
  const out: Record<string, BlockMark> = {}
  props.editor.doc.blocks.forEach((b, i) => {
    if (issuesUnder(props.issues, `blocks.${i}`).length) out[b.id] = 'issue'
  })
  return out
})
const selectedIndex = computed(() => props.editor.doc.blocks.findIndex((b) => b.id === props.editor.selectedId))
const selected = computed(() => (selectedIndex.value >= 0 ? props.editor.doc.blocks[selectedIndex.value] : undefined))
const selectedIssues = computed(() => (selectedIndex.value >= 0 ? issuesUnder(props.issues, `blocks.${selectedIndex.value}`) : []))
const withIssues = computed(() => Object.keys(marks.value).length)
</script>

<template>
  <div class="sb-canvas-frame relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div v-if="selected" class="z-20 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800" data-section-bar>
      <span class="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">{{ blockLabel(selected.type) }}</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">Section {{ selectedIndex + 1 }} of {{ editor.doc.blocks.length }}</span>
      <div class="ml-auto flex flex-wrap gap-1">
        <button type="button" class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700" :disabled="selectedIndex === 0" @click="editor.moveSection(selected.id, selectedIndex - 1)">Up</button>
        <button type="button" class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700" :disabled="selectedIndex === editor.doc.blocks.length - 1" @click="editor.moveSection(selected.id, selectedIndex + 1)">Down</button>
        <button type="button" class="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" @click="editor.duplicateSection(selected.id)">Duplicate</button>
        <button type="button" class="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950" @click="editor.removeSection(selected.id)">Remove</button>
        <button type="button" class="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700" aria-label="Deselect section" @click="editor.select(null)">✕</button>
      </div>
      <div v-if="selectedIssues.length" class="w-full border-l-4 border-red-500 bg-red-50 px-3 py-1 text-xs text-red-900" :data-field-path="`blocks.${selectedIndex}`">
        <p v-for="(issue, i) in selectedIssues" :key="i" class="m-0">{{ issue.message }}</p>
      </div>
    </div>
    <p v-else-if="withIssues" class="z-20 m-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-900">
      {{ withIssues === 1 ? 'One section has a problem' : `${withIssues} sections have problems` }} (outlined in red). Click it to see what to fix.
    </p>
    <div class="flex min-h-0 flex-1 bg-gray-100 dark:bg-gray-900">
      <p v-if="!editor.doc.blocks.length" class="m-auto p-16 text-center text-gray-500 dark:text-gray-400">This page has no sections yet. Add one from the left.</p>
      <RenderedPage
        v-else
        :doc="editor.doc"
        :device="editor.device"
        :page-id="editor.pageId"
        :path="editor.path"
        :selected-id="editor.selectedId"
        :marks="marks"
        @select="(id) => editor.select(id)"
      />
    </div>
  </div>
</template>
