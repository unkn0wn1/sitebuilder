<script setup lang="ts">
import type { MediaItem } from '../../utils/media'
import MediaGrid from '../../components/media/MediaGrid.vue'
import MediaItemPanel from '../../components/media/MediaItemPanel.vue'

definePageMeta({ layout: 'builder' })

const selectedId = ref<string | null>(null)
const grid = ref<{ load: () => Promise<void> } | null>(null)

function onSelect(item: MediaItem) {
  selectedId.value = item.id
}

function onBinned() {
  selectedId.value = null
  void grid.value?.load()
}

function onUpdated() {
  void grid.value?.load()
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-3.25rem)]">
    <div class="min-w-0 flex-1 p-6">
      <div class="mb-6 flex items-center justify-between gap-3">
        <h1 class="m-0 text-2xl font-semibold text-gray-900">Media</h1>
      </div>
      <MediaGrid ref="grid" :selected-id="selectedId" @choose="onSelect" @uploaded="onSelect" />
    </div>
    <div v-if="selectedId" class="w-80 shrink-0">
      <MediaItemPanel :item-id="selectedId" @updated="onUpdated" @binned="onBinned" />
    </div>
  </div>
</template>
