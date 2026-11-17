<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { MediaDetails, MediaItem } from '../../utils/media'
import { mediaFileUrl } from '../../utils/media'
import { can } from '#shared/roles'

const props = defineProps<{ itemId: string }>()
const emit = defineEmits<{ updated: [item: MediaItem]; binned: [id: string] }>()

const { user } = useSession()
const canBin = computed(() => user.value && can(user.value, 'media.delete'))

const details = ref<MediaDetails | null>(null)
const error = ref('')
const saving = ref(false)
const alt = ref('')
const decorative = ref(false)
const suggestion = ref<string | null>(null)
const suggestMessage = ref('')
const suggesting = ref(false)
const aiAvailable = ref(false)

async function load() {
  error.value = ''
  try {
    const data = await api<MediaDetails>(`/media/${props.itemId}`)
    details.value = data
    alt.value = data.media.alt ?? ''
    decorative.value = data.media.decorative
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load that photo.'
    details.value = null
  }
}

async function loadAiStatus() {
  try {
    const data = await api<{ available: boolean }>('/ai/status')
    aiAvailable.value = data.available
  } catch {
    aiAvailable.value = false
  }
}

watch(() => props.itemId, () => {
  suggestion.value = null
  suggestMessage.value = ''
  void load()
}, { immediate: true })

onMounted(loadAiStatus)

async function patch(body: Record<string, unknown>) {
  if (!details.value) return
  saving.value = true
  error.value = ''
  try {
    const data = await api<{ media: MediaItem }>(`/media/${props.itemId}`, { method: 'PATCH', body })
    details.value.media = { ...details.value.media, ...data.media }
    emit('updated', details.value.media)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save that.'
  } finally {
    saving.value = false
  }
}

async function saveAlt() {
  await patch({ alt: decorative.value ? null : alt.value.trim() || null, decorative: decorative.value })
}

const canSuggest = computed(() => {
  const media = details.value?.media
  if (!media || decorative.value) return false
  if (media.kind !== 'image' && media.kind !== 'svg') return false
  return aiAvailable.value
})

async function suggestAlt() {
  if (!canSuggest.value) return
  suggesting.value = true
  suggestMessage.value = ''
  suggestion.value = null
  error.value = ''
  try {
    const data = await api<{ suggestion: string | null; message?: string }>(`/media/${props.itemId}/suggest-alt`, { method: 'POST', body: {} })
    suggestion.value = data.suggestion
    suggestMessage.value = data.message ?? (data.suggestion ? '' : 'No suggestion was returned.')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not suggest alt text.'
  } finally {
    suggesting.value = false
  }
}

async function acceptSuggestion() {
  if (!suggestion.value) return
  alt.value = suggestion.value
  suggestion.value = null
  suggestMessage.value = ''
  await saveAlt()
}

function editSuggestion() {
  if (!suggestion.value) return
  alt.value = suggestion.value
  suggestion.value = null
  suggestMessage.value = ''
}

function onFocal(event: MouseEvent) {
  const media = details.value?.media
  if (!media?.width || !media.height) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * media.width)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * media.height)
  void patch({ focalX: Math.max(0, Math.min(media.width, x)), focalY: Math.max(0, Math.min(media.height, y)) })
}

async function bin() {
  if (!details.value) return
  if (details.value.usedOn.some((u) => u.live)) {
    error.value = `This image is on live pages: ${details.value.usedOn.filter((u) => u.live).map((u) => u.title).join(', ')}. Replace it there first.`
    return
  }
  if (!confirm('Move this photo to the bin?')) return
  error.value = ''
  try {
    await api(`/media/${props.itemId}`, { method: 'DELETE' })
    emit('binned', props.itemId)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not bin that photo.'
  }
}

const previewUrl = computed(() => {
  const d = details.value
  if (!d) return null
  const name = d.preview ?? d.renditions.find((n) => n.endsWith('.webp')) ?? null
  return name ? mediaFileUrl(d.media.id, name) : d.media.placeholder
})

const focalStyle = computed(() => {
  const m = details.value?.media
  if (!m?.width || !m.height || m.focalX == null || m.focalY == null) return null
  return { left: `${(m.focalX / m.width) * 100}%`, top: `${(m.focalY / m.height) * 100}%` }
})
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 lg:border-l">
    <p v-if="!details && !error" class="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
    <FwbAlert v-if="error" type="danger" class="mb-3">{{ error }}</FwbAlert>
    <template v-if="details">
      <div class="mb-3 flex justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
        <div v-if="previewUrl" class="relative inline-block max-h-64 max-w-full">
          <img
            :src="previewUrl"
            :alt="details.media.alt || details.media.filename"
            class="max-h-64 w-auto max-w-full cursor-crosshair"
            @click="onFocal"
          />
          <span
            v-if="focalStyle"
            class="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow"
            :style="focalStyle"
          />
        </div>
      </div>
      <p class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">{{ details.media.filename }}</p>
      <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
        <span v-if="details.media.width && details.media.height">{{ details.media.width }} × {{ details.media.height }}</span>
        <span v-else>{{ details.media.kind }}</span>
        · {{ details.media.status === 'ready' ? 'Ready' : details.media.status === 'processing' ? 'Processing' : 'Failed' }}
      </p>

      <div class="mb-3">
        <FwbInput v-model="alt" label="Alt text" :disabled="decorative || saving" @blur="saveAlt" />
        <label class="mt-2 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" :checked="decorative" :disabled="saving" @change="decorative = ($event.target as HTMLInputElement).checked; saveAlt()">
          Decorative only
        </label>
        <div v-if="canSuggest" class="mt-2 flex flex-wrap items-center gap-2">
          <FwbButton size="sm" color="light" :disabled="suggesting || saving" data-testid="suggest-alt" @click="suggestAlt">
            {{ suggesting ? 'Suggesting…' : 'Suggest alt text' }}
          </FwbButton>
        </div>
        <div v-if="suggestion" class="mt-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-gray-900 dark:border-blue-800 dark:bg-blue-950 dark:text-gray-100" data-testid="alt-suggestion">
          <p class="m-0 font-medium">Suggested</p>
          <p class="mb-2 mt-1">{{ suggestion }}</p>
          <p class="mb-2 mt-0 text-xs text-gray-600 dark:text-gray-400">Check this before using it. The assistant must not invent names or places.</p>
          <div class="flex flex-wrap gap-2">
            <FwbButton size="sm" :disabled="saving" data-testid="accept-alt" @click="acceptSuggestion">Use this</FwbButton>
            <FwbButton size="sm" color="light" @click="editSuggestion">Edit</FwbButton>
            <FwbButton size="sm" color="light" @click="suggestion = null">Discard</FwbButton>
          </div>
        </div>
        <p v-else-if="suggestMessage" class="mt-2 text-sm text-gray-600 dark:text-gray-400">{{ suggestMessage }}</p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Click the photo to set the focal point, used when cropping.</p>
      </div>

      <div v-if="details.crops.length" class="mb-3">
        <p class="mb-1 text-sm font-medium text-gray-800 dark:text-gray-200">Crops</p>
        <ul class="m-0 list-none p-0 text-sm text-gray-600 dark:text-gray-400">
          <li v-for="crop in details.crops" :key="crop.id">{{ crop.ratio }} approved</li>
        </ul>
      </div>

      <div class="mb-4">
        <p class="mb-1 text-sm font-medium text-gray-800 dark:text-gray-200">Used on</p>
        <p v-if="!details.usedOn.length" class="text-sm text-gray-500 dark:text-gray-400">Not used on a page yet.</p>
        <ul v-else class="m-0 list-none p-0 text-sm">
          <li v-for="use in details.usedOn" :key="use.pageId">
            <NuxtLink :to="use.href ?? `/pages/${use.pageId}`" class="text-blue-700 dark:text-blue-400 no-underline hover:underline">{{ use.title }}</NuxtLink>
            <span class="text-gray-500 dark:text-gray-400"> · {{ use.live ? 'Live' : 'Draft' }}</span>
          </li>
        </ul>
      </div>

      <FwbButton v-if="canBin" color="light" size="sm" @click="bin">Bin</FwbButton>
    </template>
  </aside>
</template>
