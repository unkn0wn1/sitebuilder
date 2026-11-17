<script setup lang="ts">
import { api, apiUpload, ApiError, waitForJob } from '../../utils/api'
import type { MediaItem } from '../../utils/media'
import { mediaFileUrl } from '../../utils/media'

const props = defineProps<{
  kind?: 'image' | 'video'
  selectedId?: string | null
}>()
const emit = defineEmits<{ choose: [item: MediaItem]; uploaded: [item: MediaItem] }>()

const items = ref<MediaItem[]>([])
const total = ref(0)
const search = ref('')
const loading = ref(true)
const error = ref('')
const uploading = ref(false)
const dragOver = ref(false)
const input = ref<HTMLInputElement | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = new URLSearchParams()
    if (search.value) q.set('search', search.value)
    if (props.kind) q.set('kind', props.kind)
    q.set('pageSize', '50')
    const data = await api<{ items: MediaItem[]; total: number }>(`/media?${q.toString()}`)
    items.value = data.items
    total.value = data.total
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the media library.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.kind, load)

async function uploadFiles(files: FileList | File[]) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
  if (!list.length) {
    error.value = 'Use a JPEG, PNG, WebP, AVIF or a prepared video.'
    return
  }
  uploading.value = true
  error.value = ''
  try {
    let last: MediaItem | null = null
    for (const file of list) {
      const result = await apiUpload<{ media: MediaItem; jobId: string | null; duplicate?: boolean }>('/media', file)
      last = result.media
      if (result.jobId) {
        const job = await waitForJob(result.jobId)
        if (job.state === 'failed') throw new ApiError(500, 'job_failed', job.lastError || 'Making web-friendly sizes failed.')
      }
    }
    await load()
    if (last) {
      const fresh = items.value.find((i) => i.id === last!.id) ?? last
      emit('uploaded', fresh)
      emit('choose', fresh)
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not upload that file.'
  } finally {
    uploading.value = false
  }
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const files = event.dataTransfer?.files
  if (files?.length) void uploadFiles(files)
}

defineExpose({ load, items: () => items.value })
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="w-64 max-w-full">
        <FwbInput v-model="search" placeholder="Search photos" @keyup.enter="load" />
      </div>
      <FwbButton color="light" size="sm" @click="load">Search</FwbButton>
      <input ref="input" type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" multiple class="hidden" @change="input?.files && uploadFiles(input.files); if (input) input.value = ''" />
      <FwbButton size="sm" @click="input?.click()">Upload</FwbButton>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="uploading" class="mb-3 text-sm text-gray-600 dark:text-gray-400">Making web-friendly sizes…</p>

    <div
      class="rounded-lg border border-dashed p-3"
      :class="dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <p v-if="loading" class="p-6 text-gray-500 dark:text-gray-400">Loading photos…</p>
      <p v-else-if="!items.length" class="p-6 text-center text-gray-500 dark:text-gray-400">No photos yet. Drag some here.</p>
      <ul v-else class="m-0 grid list-none grid-cols-2 gap-3 p-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <li v-for="item in items" :key="item.id">
          <button
            type="button"
            class="block w-full overflow-hidden rounded-md border bg-gray-100 dark:bg-gray-800 text-left"
            :class="selectedId === item.id ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-500'"
            @click.stop="emit('choose', item)"
          >
            <img
              v-if="item.preview || item.placeholder"
              :src="item.preview ? mediaFileUrl(item.id, item.preview) : item.placeholder!"
              :alt="item.alt || item.filename"
              class="aspect-square h-auto w-full object-cover"
            />
            <div v-else class="flex aspect-square items-center justify-center text-xs text-gray-500 dark:text-gray-400">
              {{ item.status === 'processing' ? 'Processing…' : item.filename }}
            </div>
            <span class="block truncate px-2 py-1 text-xs text-gray-600 dark:text-gray-400">{{ item.filename }}</span>
          </button>
        </li>
      </ul>
      <p v-if="total" class="mt-3 px-1 text-sm text-gray-500 dark:text-gray-400">{{ total }} {{ total === 1 ? 'item' : 'items' }}</p>
    </div>
  </div>
</template>
