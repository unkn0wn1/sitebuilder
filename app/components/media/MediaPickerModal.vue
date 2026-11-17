<script setup lang="ts">
import type { MediaItem } from '../../utils/media'
import MediaGrid from './MediaGrid.vue'
import BuilderSimpleModal from '../builder/SimpleModal.vue'

defineProps<{ selectedId?: string | null }>()
const emit = defineEmits<{ close: []; pick: [item: MediaItem] }>()

const chosen = ref<MediaItem | null>(null)

function choose(item: MediaItem) {
  chosen.value = item
}

function useChosen() {
  if (chosen.value) emit('pick', chosen.value)
}
</script>

<template>
  <BuilderSimpleModal title="Choose a photo" @close="emit('close')">
    <MediaGrid kind="image" :selected-id="chosen?.id ?? selectedId ?? null" @choose="choose" @uploaded="choose" />
    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded-md border border-gray-200 px-3 py-2 text-sm" @click="emit('close')">Cancel</button>
        <button type="button" class="rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50" :disabled="!chosen" @click="useChosen">Use this photo</button>
      </div>
    </template>
  </BuilderSimpleModal>
</template>
