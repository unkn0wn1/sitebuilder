<script setup lang="ts">
import { blockCatalog, blockLabel } from '../../utils/block-fields'
import AssistantPanel from './AssistantPanel.vue'
import type { LeftTab, PageEditor } from '../../utils/page-editor'
import type { useAssistant } from '../../composables/useAssistant'

const props = defineProps<{ editor: PageEditor; assistant: ReturnType<typeof useAssistant> }>()

const tabs: { id: LeftTab; label: string }[] = [
  { id: 'assistant', label: 'Assistant' },
  { id: 'add', label: 'Add' },
  { id: 'outline', label: 'Outline' },
]

const catalog = computed(() => {
  const allowed = new Set(props.editor.allowedTypes)
  const items = blockCatalog().filter((b) => allowed.has(b.type))
  const groups = new Map<string, typeof items>()
  for (const item of items) {
    const list = groups.get(item.category) ?? []
    list.push(item)
    groups.set(item.category, list)
  }
  return [...groups.entries()]
})

function onOutlineKey(event: KeyboardEvent, id: string, index: number) {
  if (event.altKey && event.key === 'ArrowUp') {
    event.preventDefault()
    props.editor.moveSection(id, index - 1)
  }
  if (event.altKey && event.key === 'ArrowDown') {
    event.preventDefault()
    props.editor.moveSection(id, index + 1)
  }
}
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white" :class="editor.railCollapsed ? 'w-14' : 'w-72'">
    <div class="flex items-center gap-1 border-b border-gray-200 p-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-1 rounded-md px-2 py-2 text-sm"
        :class="editor.leftTab === tab.id ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-600 hover:bg-gray-50'"
        :title="tab.label"
        :aria-current="editor.leftTab === tab.id ? 'page' : undefined"
        @click="editor.setLeftTab(tab.id)"
      >
        <span :class="{ 'sr-only': editor.railCollapsed }">{{ tab.label }}</span>
        <span v-if="editor.railCollapsed" aria-hidden="true">{{ tab.label[0] }}</span>
      </button>
    </div>

    <div v-if="!editor.railCollapsed" class="min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="editor.leftTab === 'assistant'" class="flex h-full min-h-0 flex-col">
        <AssistantPanel :assistant="assistant" />
      </div>

      <div v-else-if="editor.leftTab === 'add'">
        <p class="mb-3 text-sm text-gray-600">Add a section to this {{ editor.templateLabel.toLowerCase() }} page.</p>
        <div v-for="[category, items] in catalog" :key="category" class="mb-4">
          <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{{ category }}</h3>
          <button
            v-for="item in items"
            :key="item.type"
            type="button"
            class="mb-1 block w-full rounded-md px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-100"
            @click="editor.addSection(item.type, editor.selectedId)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <div v-else>
        <p v-if="!editor.doc.blocks.length" class="text-sm text-gray-500">No sections yet. Add one from the Add tab.</p>
        <ol class="m-0 list-none p-0">
          <li v-for="(block, index) in editor.doc.blocks" :key="block.id">
            <button
              type="button"
              class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm"
              :class="editor.selectedId === block.id ? 'bg-blue-50 font-medium text-blue-900' : 'text-gray-800 hover:bg-gray-100'"
              @click="editor.select(block.id)"
              @keydown="onOutlineKey($event, block.id, index)"
            >
              <span>{{ index + 1 }}. {{ blockLabel(block.type) }}</span>
            </button>
            <div v-if="editor.selectedId === block.id" class="mb-1 flex justify-end gap-1 px-2">
              <button type="button" class="text-xs text-gray-600 hover:underline" :disabled="index === 0" @click="editor.moveSection(block.id, index - 1)">Up</button>
              <button type="button" class="text-xs text-gray-600 hover:underline" :disabled="index === editor.doc.blocks.length - 1" @click="editor.moveSection(block.id, index + 1)">Down</button>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <button type="button" class="border-t border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50" @click="editor.toggleRail()">
      {{ editor.railCollapsed ? '»' : '« Hide' }}
    </button>
  </aside>
</template>
