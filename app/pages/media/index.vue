<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { MediaItem } from '../../utils/media'
import MediaGrid from '../../components/media/MediaGrid.vue'
import MediaItemPanel from '../../components/media/MediaItemPanel.vue'

definePageMeta({ layout: 'builder' })

const selectedId = ref<string | null>(null)
const grid = ref<{ load: () => Promise<void>; items: () => MediaItem[] } | null>(null)
const aiAvailable = ref(false)
const batching = ref(false)
const batchError = ref('')
const batchItems = ref<{ mediaId: string; filename: string; suggestion: string | null; message?: string }[]>([])
const acceptingId = ref<string | null>(null)

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

const missingAltCount = computed(() =>
  (grid.value?.items() ?? []).filter((item) => (item.kind === 'image' || item.kind === 'svg') && !item.decorative && !item.alt?.trim()).length,
)

onMounted(async () => {
  try {
    const data = await api<{ available: boolean }>('/ai/status')
    aiAvailable.value = data.available
  } catch {
    aiAvailable.value = false
  }
})

async function batchSuggest() {
  batching.value = true
  batchError.value = ''
  try {
    const data = await api<{ items: { mediaId: string; filename: string; suggestion: string | null; message?: string }[] }>('/media/suggest-alt', { method: 'POST', body: {} })
    batchItems.value = data.items
    if (!data.items.length) batchError.value = 'Every image already has alt text, or is marked decorative.'
  } catch (err) {
    batchError.value = err instanceof ApiError ? err.message : 'Could not suggest alt text.'
  } finally {
    batching.value = false
  }
}

async function acceptBatch(item: { mediaId: string; suggestion: string | null }) {
  if (!item.suggestion) return
  acceptingId.value = item.mediaId
  try {
    await api(`/media/${item.mediaId}`, { method: 'PATCH', body: { alt: item.suggestion, decorative: false } })
    batchItems.value = batchItems.value.filter((row) => row.mediaId !== item.mediaId)
    await grid.value?.load()
  } catch (err) {
    batchError.value = err instanceof ApiError ? err.message : 'Could not save that alt text.'
  } finally {
    acceptingId.value = null
  }
}

function editBatch(item: { mediaId: string; suggestion: string | null }) {
  selectedId.value = item.mediaId
}
</script>

<template>
  <div class="flex min-h-[calc(100dvh-var(--sb-top))] min-w-0 flex-col lg:flex-row">
    <div class="sb-page min-w-0 flex-1">
      <UiPageHeader title="Media" description="Photos, videos and files used on the site. Good alt text helps everyone.">
        <FwbButton
          v-if="aiAvailable && missingAltCount"
          color="light"
          size="sm"
          :disabled="batching"
          data-testid="batch-suggest-alt"
          @click="batchSuggest"
        >
          {{ batching ? 'Suggesting…' : `Suggest alt text for ${missingAltCount} ${missingAltCount === 1 ? 'image' : 'images'}` }}
        </FwbButton>
      </UiPageHeader>
      <p v-if="batchError" class="mb-4 text-sm text-gray-700 dark:text-gray-300">{{ batchError }}</p>
      <div v-if="batchItems.length" class="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3" data-testid="batch-alt-suggestions">
        <p class="mt-0 mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Suggested alt text — not saved until you use it</p>
        <ul class="m-0 list-none space-y-3 p-0">
          <li v-for="item in batchItems" :key="item.mediaId" class="min-w-0 rounded-md bg-gray-50 p-2 text-sm dark:bg-gray-900">
            <p class="m-0 font-medium break-words text-gray-800 dark:text-gray-200">{{ item.filename }}</p>
            <p v-if="item.suggestion" class="mb-2 mt-1 break-words text-gray-700 dark:text-gray-300">{{ item.suggestion }}</p>
            <p v-else class="mb-2 mt-1 text-gray-600 dark:text-gray-400">{{ item.message || 'No suggestion.' }}</p>
            <div v-if="item.suggestion" class="flex flex-wrap gap-2">
              <FwbButton size="sm" :disabled="acceptingId === item.mediaId" @click="acceptBatch(item)">Use this</FwbButton>
              <FwbButton size="sm" color="light" @click="editBatch(item)">Edit</FwbButton>
            </div>
          </li>
        </ul>
      </div>
      <MediaGrid ref="grid" :selected-id="selectedId" @choose="onSelect" @uploaded="onSelect" />
    </div>
    <div v-if="selectedId" class="min-w-0 w-full border-t border-gray-200 dark:border-gray-700 lg:w-80 lg:shrink-0 lg:border-t-0">
      <MediaItemPanel :item-id="selectedId" @updated="onUpdated" @binned="onBinned" />
    </div>
  </div>
</template>
