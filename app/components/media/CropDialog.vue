<script setup lang="ts">
import { defaultCropRect, parseRatio, type CropRect } from '#shared/crop'
import { api, ApiError } from '../../utils/api'
import type { MediaDetails } from '../../utils/media'
import { mediaFileUrl } from '../../utils/media'
import BuilderSimpleModal from '../builder/SimpleModal.vue'

const props = defineProps<{
  mediaId: string
  ratio: string
  title?: string
}>()
const emit = defineEmits<{ close: []; approved: [cropId: string] }>()

const error = ref('')
const saving = ref(false)
const details = ref<MediaDetails | null>(null)
const rect = ref<CropRect>({ x: 0, y: 0, width: 16, height: 16 })
const frame = ref<HTMLElement | null>(null)
const display = ref({ width: 1, height: 1 })
let drag: { mode: 'move' | 'resize'; startX: number; startY: number; origin: CropRect } | null = null

const image = computed(() => details.value?.media)
const src = computed(() => {
  const d = details.value
  if (!d) return null
  const name = d.renditions.find((n) => n.endsWith('-1280.webp')) ?? d.preview ?? d.renditions.find((n) => n.endsWith('.webp'))
  return name ? mediaFileUrl(d.media.id, name) : d.media.placeholder
})

const scale = computed(() => display.value.width / (image.value?.width ?? 1))

const boxStyle = computed(() => {
  const s = scale.value
  return {
    left: `${rect.value.x * s}px`,
    top: `${rect.value.y * s}px`,
    width: `${rect.value.width * s}px`,
    height: `${rect.value.height * s}px`,
  }
})

function previewStyle(widthPx: number) {
  const m = image.value
  if (!m?.width || !m.height) return { box: { width: `${widthPx}px` }, img: {} }
  const scaleX = widthPx / rect.value.width
  return {
    box: { width: `${widthPx}px`, height: `${Math.max(1, rect.value.height * scaleX)}px` },
    img: {
      width: `${m.width * scaleX}px`,
      height: `${m.height * scaleX}px`,
      marginLeft: `${-rect.value.x * scaleX}px`,
      marginTop: `${-rect.value.y * scaleX}px`,
      maxWidth: 'none',
    },
  }
}

const computerPreview = computed(() => previewStyle(240))
const phonePreview = computed(() => previewStyle(120))

async function load() {
  error.value = ''
  try {
    const data = await api<MediaDetails>(`/media/${props.mediaId}`)
    details.value = data
    const m = data.media
    if (!m.width || !m.height) throw new Error('This photo is still processing.')
    const existing = data.crops.find((c) => c.ratio === props.ratio)
    rect.value = existing
      ? { x: existing.x, y: existing.y, width: existing.width, height: existing.height }
      : defaultCropRect({ width: m.width, height: m.height, focalX: m.focalX, focalY: m.focalY }, props.ratio)
    await nextTick()
    measure()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not open this crop.'
  }
}

onMounted(load)

function measure() {
  if (!frame.value || !image.value?.width || !image.value.height) return
  const maxW = frame.value.clientWidth || 560
  const maxH = 400
  const ratio = image.value.width / image.value.height
  let width = maxW
  let height = width / ratio
  if (height > maxH) {
    height = maxH
    width = height * ratio
  }
  display.value = { width, height }
}

function clampRect(next: CropRect): CropRect {
  const w = image.value?.width ?? 0
  const h = image.value?.height ?? 0
  const width = Math.max(16, Math.min(next.width, w))
  const height = Math.max(16, Math.min(next.height, h))
  return {
    x: Math.max(0, Math.min(next.x, w - width)),
    y: Math.max(0, Math.min(next.y, h - height)),
    width,
    height,
  }
}

function startMove(event: MouseEvent) {
  event.preventDefault()
  drag = { mode: 'move', startX: event.clientX, startY: event.clientY, origin: { ...rect.value } }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

function startResize(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  drag = { mode: 'resize', startX: event.clientX, startY: event.clientY, origin: { ...rect.value } }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

function onDrag(event: MouseEvent) {
  if (!drag || !image.value?.width || !image.value.height) return
  const s = scale.value || 1
  const dx = (event.clientX - drag.startX) / s
  const dy = (event.clientY - drag.startY) / s
  if (drag.mode === 'move') {
    rect.value = clampRect({ ...drag.origin, x: Math.round(drag.origin.x + dx), y: Math.round(drag.origin.y + dy) })
    return
  }
  const aspect = parseRatio(props.ratio).w / parseRatio(props.ratio).h
  let width = Math.round(drag.origin.width + dx)
  let height = Math.round(width / aspect)
  if (height < 16) {
    height = 16
    width = Math.round(height * aspect)
  }
  rect.value = clampRect({ x: drag.origin.x, y: drag.origin.y, width, height })
}

function stopDrag() {
  drag = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

async function approve() {
  saving.value = true
  error.value = ''
  try {
    const result = await api<{ cropId: string }>(`/media/${props.mediaId}/crops`, {
      method: 'POST',
      body: { ratio: props.ratio, rect: rect.value },
    })
    emit('approved', result.cropId)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save that crop.'
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(stopDrag)
</script>

<template>
  <BuilderSimpleModal :title="title || `Crop for ${ratio}`" @close="emit('close')">
    
      <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">Move or resize the frame to choose what shows. The shape stays {{ ratio }}.</p>
      <FwbAlert v-if="error" type="danger" class="mb-3">{{ error }}</FwbAlert>
      <div class="flex flex-col gap-4 md:flex-row">
        <div ref="frame" class="relative min-h-[12rem] flex-1 bg-gray-100 dark:bg-gray-800">
          <div v-if="src && image?.width" class="relative mx-auto" :style="{ width: `${display.width}px`, height: `${display.height}px` }">
            <img :src="src" alt="" class="block h-full w-full select-none" draggable="false" @load="measure" />
            <div
              class="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              :style="boxStyle"
              @mousedown="startMove"
            >
              <button type="button" class="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize bg-white dark:bg-gray-800" aria-label="Resize crop" @mousedown="startResize" />
            </div>
          </div>
        </div>
        <div class="w-60 shrink-0">
          <p class="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">On a computer</p>
          <div class="mb-3 overflow-hidden rounded bg-gray-100 dark:bg-gray-800" :style="computerPreview.box">
            <img v-if="src" :src="src" alt="" class="block" :style="computerPreview.img" />
          </div>
          <p class="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">On a phone</p>
          <div class="overflow-hidden rounded bg-gray-100 dark:bg-gray-800" :style="phonePreview.box">
            <img v-if="src" :src="src" alt="" class="block" :style="phonePreview.img" />
          </div>
        </div>
      </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <FwbButton color="light" @click="emit('close')">Cancel</FwbButton>
        <FwbButton :disabled="saving || !image" @click="approve">{{ saving ? 'Saving…' : 'Use this crop' }}</FwbButton>
      </div>
    </template>
  </BuilderSimpleModal>
</template>
