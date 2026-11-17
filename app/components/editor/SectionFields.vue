<script setup lang="ts">
import { fieldsForBlock, imageSlotFor, type FieldSpec } from '../../utils/block-fields'
import { richTextFromParagraphs, richTextToPlain, type RichTextDoc } from '#shared/richtext'
import { parseRatio } from '#shared/crop'
import { api } from '../../utils/api'
import { mediaFileUrl, type MediaDetails, type MediaItem } from '../../utils/media'
import MediaPickerModal from '../media/MediaPickerModal.vue'
import CropDialog from '../media/CropDialog.vue'

const props = defineProps<{
  type: string
  modelValue: Record<string, unknown>
}>()

const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>] }>()

const fields = computed(() => fieldsForBlock(props.type))

function get(path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), props.modelValue)
}

function set(path: string, value: unknown) {
  const next = structuredClone(props.modelValue)
  const parts = path.split('.')
  let cur: Record<string, unknown> = next
  for (const key of parts.slice(0, -1)) {
    const existing = cur[key]
    if (!existing || typeof existing !== 'object') cur[key] = {}
    cur = cur[key] as Record<string, unknown>
  }
  cur[parts.at(-1)!] = value
  emit('update:modelValue', next)
}

function textValue(path: string): string {
  const value = get(path)
  return typeof value === 'string' ? value : ''
}

function richValue(path: string): string {
  const value = get(path)
  if (value && typeof value === 'object' && 'content' in (value as object)) return richTextToPlain(value as RichTextDoc)
  return typeof value === 'string' ? value : ''
}

function setRich(path: string, text: string) {
  set(path, richTextFromParagraphs(text.split(/\n+/).filter((l) => l.length > 0).length ? text.split(/\n+/) : ['']))
}

function listItems(field: FieldSpec): Record<string, unknown>[] {
  const value = get(field.path)
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

function updateItem(field: FieldSpec, index: number, key: string, value: unknown) {
  const items = listItems(field).map((item, i) => (i === index ? { ...item, [key]: value } : item))
  set(field.path, items)
}

function addItem(field: FieldSpec) {
  const blank: Record<string, unknown> = {}
  for (const sub of field.item ?? []) {
    if (sub.kind === 'richtext') blank[sub.name] = richTextFromParagraphs([''])
    else if (sub.kind === 'boolean') blank[sub.name] = false
    else if (!sub.optional) blank[sub.name] = ''
  }
  set(field.path, [...listItems(field), blank])
}

function removeItem(field: FieldSpec, index: number) {
  set(field.path, listItems(field).filter((_, i) => i !== index))
}

const pickerFor = ref<string | null>(null)
const cropFor = ref<{ path: string; mediaId: string; ratio: string; title: string } | null>(null)
const previews = ref<Record<string, { alt: string; src: string | null; width: number; height: number }>>({})

async function loadPreview(id: string) {
  if (!id || previews.value[id]) return
  try {
    const data = await api<MediaDetails>(`/media/${id}`)
    const name = data.preview ?? data.renditions.find((n) => n.endsWith('.webp'))
    previews.value[id] = {
      alt: data.media.alt ?? '',
      src: name ? mediaFileUrl(id, name) : data.media.placeholder,
      width: data.media.width ?? 0,
      height: data.media.height ?? 0,
    }
  } catch {
    previews.value[id] = { alt: '', src: null, width: 0, height: 0 }
  }
}

watch(
  () => props.modelValue,
  () => {
    for (const field of fields.value) {
      if (field.kind !== 'image') continue
      const id = textValue(`${field.path}.media`)
      if (id) void loadPreview(id)
    }
  },
  { immediate: true, deep: true },
)

function slotOf(field: FieldSpec) {
  return imageSlotFor(props.type, field.path)
}

function needsCrop(item: MediaItem, ratio: string) {
  if (!item.width || !item.height) return false
  const { w, h } = parseRatio(ratio)
  return Math.abs(item.width / item.height - w / h) > 0.02
}

function onPicked(item: MediaItem) {
  const field = fields.value.find((f) => f.path === pickerFor.value)
  if (!field) return
  pick(field, item)
}

function pick(field: FieldSpec, item: MediaItem) {
  const next = structuredClone(props.modelValue)
  const apply = (path: string, value: unknown) => {
    const parts = path.split('.')
    let cur: Record<string, unknown> = next
    for (const key of parts.slice(0, -1)) {
      const existing = cur[key]
      if (!existing || typeof existing !== 'object') cur[key] = {}
      cur = cur[key] as Record<string, unknown>
    }
    cur[parts.at(-1)!] = value
  }
  apply(`${field.path}.media`, item.id)
  const currentAlt = textValue(`${field.path}.alt`)
  if (!currentAlt && item.alt) apply(`${field.path}.alt`, item.alt)
  emit('update:modelValue', next)
  previews.value[item.id] = {
    alt: item.alt ?? '',
    src: item.preview ? mediaFileUrl(item.id, item.preview) : item.placeholder,
    width: item.width ?? 0,
    height: item.height ?? 0,
  }
  pickerFor.value = null
  const slot = slotOf(field)
  if (slot && needsCrop(item, slot.ratio)) {
    cropFor.value = {
      path: field.path,
      mediaId: item.id,
      ratio: slot.ratio,
      title: `Crop for ${field.label} (needs ${slot.ratio}, at least ${slot.width} × ${slot.height})`,
    }
  }
}

function previewOf(path: string) {
  const id = textValue(`${path}.media`)
  return id ? previews.value[id] : undefined
}

function openCrop(field: FieldSpec) {
  const id = textValue(`${field.path}.media`)
  const slot = slotOf(field)
  if (!id || !slot) return
  cropFor.value = {
    path: field.path,
    mediaId: id,
    ratio: slot.ratio,
    title: `Crop for ${field.label} (needs ${slot.ratio}, at least ${slot.width} × ${slot.height})`,
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-for="field in fields" :key="field.path">
      <FwbInput
        v-if="field.kind === 'text'"
        :model-value="textValue(field.path)"
        :label="field.label"
        :required="!field.optional"
        @update:model-value="set(field.path, $event)"
      />
      <p v-if="field.kind === 'text' && field.max && textValue(field.path).length > field.max - 15" class="mt-1 text-xs text-gray-500">
        {{ textValue(field.path).length }} / {{ field.max }}
      </p>

      <FwbTextarea
        v-else-if="field.kind === 'textarea' || field.kind === 'richtext'"
        :model-value="field.kind === 'richtext' ? richValue(field.path) : textValue(field.path)"
        :label="field.label"
        :rows="field.kind === 'richtext' ? 6 : 3"
        @update:model-value="field.kind === 'richtext' ? setRich(field.path, String($event)) : set(field.path, $event)"
      />

      <FwbSelect
        v-else-if="field.kind === 'enum'"
        :model-value="textValue(field.path)"
        :label="field.label"
        :options="(field.options ?? []).map((o) => ({ value: o, name: o.replace(/-/g, ' ') }))"
        @update:model-value="set(field.path, $event)"
      />

      <label v-else-if="field.kind === 'boolean'" class="flex items-center gap-2 text-sm text-gray-800">
        <input type="checkbox" :checked="Boolean(get(field.path))" @change="set(field.path, ($event.target as HTMLInputElement).checked)">
        {{ field.label }}
      </label>

      <div v-else-if="field.kind === 'link'" class="rounded-md border border-gray-200 p-3">
        <p class="mb-2 text-sm font-medium text-gray-800">{{ field.label }}</p>
        <div class="flex flex-col gap-2">
          <FwbInput :model-value="textValue(`${field.path}.label`)" label="Label" @update:model-value="set(`${field.path}.label`, $event)" />
          <FwbInput :model-value="textValue(`${field.path}.href`)" label="Link" @update:model-value="set(`${field.path}.href`, $event)" />
        </div>
      </div>

      <div v-else-if="field.kind === 'image'" class="rounded-md border border-gray-200 p-3">
        <p class="mb-2 text-sm font-medium text-gray-800">{{ field.label }}</p>
        <img
          v-if="previewOf(field.path)?.src"
          :src="previewOf(field.path)!.src!"
          :alt="textValue(`${field.path}.alt`) || previewOf(field.path)?.alt || ''"
          class="mb-2 max-h-40 w-full rounded object-cover"
        />
        <p v-else-if="textValue(`${field.path}.media`)" class="mb-2 text-xs text-gray-500">Photo {{ textValue(`${field.path}.media`) }}</p>
        <p v-else class="mb-2 text-xs text-gray-500">No photo yet.</p>
        <div class="mb-2 flex flex-wrap gap-2">
          <FwbButton size="sm" color="light" type="button" @click="pickerFor = field.path">Change</FwbButton>
          <FwbButton v-if="textValue(`${field.path}.media`) && slotOf(field)" size="sm" color="light" type="button" @click="openCrop(field)">Crop</FwbButton>
        </div>
        <FwbInput :model-value="textValue(`${field.path}.alt`)" label="Alt text" @update:model-value="set(`${field.path}.alt`, $event)" />
      </div>

      <FwbInput
        v-else-if="field.kind === 'media' || field.kind === 'embed'"
        :model-value="textValue(field.path)"
        :label="field.label"
        @update:model-value="set(field.path, $event)"
      />

      <div v-else-if="field.kind === 'list'" class="rounded-md border border-gray-200 p-3">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-medium text-gray-800">{{ field.label }}</p>
          <button type="button" class="text-sm text-blue-700 hover:underline" @click="addItem(field)">Add</button>
        </div>
        <div v-for="(item, index) in listItems(field)" :key="index" class="mb-3 border-b border-gray-100 pb-3 last:mb-0 last:border-0 last:pb-0">
          <div v-for="sub in field.item ?? []" :key="sub.name" class="mb-2">
            <FwbTextarea
              v-if="sub.kind === 'richtext' || sub.kind === 'textarea'"
              :model-value="sub.kind === 'richtext' ? richTextToPlain((item[sub.name] as RichTextDoc) ?? { type: 'doc', content: [] }) : String(item[sub.name] ?? '')"
              :label="sub.label"
              :rows="3"
              @update:model-value="updateItem(field, index, sub.name, sub.kind === 'richtext' ? richTextFromParagraphs(String($event).split(/\n+/)) : $event)"
            />
            <FwbInput
              v-else
              :model-value="String(item[sub.name] ?? '')"
              :label="sub.label"
              @update:model-value="updateItem(field, index, sub.name, $event)"
            />
          </div>
          <button type="button" class="text-xs text-red-700 hover:underline" @click="removeItem(field, index)">Remove</button>
        </div>
      </div>
    </div>
    <MediaPickerModal v-if="pickerFor" :selected-id="pickerFor ? textValue(`${pickerFor}.media`) : null" @close="pickerFor = null" @pick="onPicked($event)" />
    <CropDialog v-if="cropFor" :media-id="cropFor.mediaId" :ratio="cropFor.ratio" :title="cropFor.title" @close="cropFor = null" @approved="cropFor = null" />
  </div>
</template>
