<script setup lang="ts">
import { canvasScale } from '../../utils/format'
import { DEVICE_WIDTHS, type PageEditor } from '../../utils/page-editor'
import type { FieldIssue } from '#shared/issues'
import { issuesUnder } from '#shared/field-issues'
import { CANVAS_SCOPE, SCOPED_THEME_CSS } from '../../utils/theme-css'

const props = withDefaults(defineProps<{ editor: PageEditor; issues?: FieldIssue[] }>(), { issues: () => [] })

function blockIssues(index: number) {
  return issuesUnder(props.issues, `blocks.${index}`)
}


const host = ref<HTMLElement | null>(null)
const available = ref(1280)

function measure() {
  available.value = host.value?.clientWidth ?? 1280
}

onMounted(() => {
  measure()
  const observer = new ResizeObserver(measure)
  if (host.value) observer.observe(host.value)
  onBeforeUnmount(() => observer.disconnect())
})

const width = computed(() => DEVICE_WIDTHS[props.editor.device])
const scale = computed(() => canvasScale(Math.max(available.value - 48, 160), width.value))
</script>

<template>
  <div ref="host" class="sb-canvas-frame relative min-h-0 min-w-0 flex-1 overflow-auto" @click="editor.select(null)">
    <component :is="'style'">{{ SCOPED_THEME_CSS }}</component>
    <p v-if="scale < 1" class="sticky top-0 z-10 m-0 bg-gray-100/90 dark:bg-gray-800/90 px-4 py-1 text-center text-xs text-gray-600 dark:text-gray-400">Shown at {{ Math.round(scale * 100) }}%</p>
    <div class="flex justify-center p-6" :style="{ minHeight: '100%' }">
      <div
        :class="CANVAS_SCOPE"
        class="origin-top bg-[var(--paper,#fffaf3)] shadow-md"
        :style="{ width: `${width}px`, transform: `scale(${scale})`, marginBottom: scale < 1 ? `${-(1 - scale) * 800}px` : undefined }"
        @click.stop
      >
        <p v-if="!editor.doc.blocks.length" class="p-16 text-center text-gray-500 dark:text-gray-400">This page has no sections yet. Add one from the left.</p>
        <div v-for="(block, index) in editor.doc.blocks" :key="block.id" class="group relative" :data-block-id="block.id">
          <EditorSectionView
            :block="block"
            :selected="editor.selectedId === block.id"
            :first-hero="index === 0"
            @select="editor.select(block.id)"
            @change-text="(prop, value) => editor.updateProps(block.id, { [prop]: value })"
          />
          <div
            v-if="blockIssues(index).length"
            class="border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm text-red-900"
            :data-field-path="`blocks.${index}`"
          >
            <p v-for="(issue, i) in blockIssues(index)" :key="i" class="m-0">{{ issue.message }}</p>
          </div>
          <div
            v-if="editor.selectedId === block.id"
            class="absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1 rounded-md bg-white/95 dark:bg-gray-800/95 p-1 shadow"
            @click.stop
          >
            <button type="button" class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800" :disabled="index === 0" @click="editor.moveSection(block.id, index - 1)">Up</button>
            <button type="button" class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800" :disabled="index === editor.doc.blocks.length - 1" @click="editor.moveSection(block.id, index + 1)">Down</button>
            <button type="button" class="px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800" @click="editor.duplicateSection(block.id)">Duplicate</button>
            <button type="button" class="px-2 py-1 text-xs text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950" @click="editor.removeSection(block.id)">Remove</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
