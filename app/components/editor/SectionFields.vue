<script setup lang="ts">
import { fieldsForBlock, imageSlotFor, type FieldSpec } from '../../utils/block-fields'
import { richTextFromParagraphs, richTextToPlain, type RichTextDoc } from '#shared/richtext'
import { parseRatio } from '#shared/crop'
import { api } from '../../utils/api'
import { mediaFileUrl, mediaVersion, type MediaDetails, type MediaItem } from '../../utils/media'
import MediaPickerModal from '../media/MediaPickerModal.vue'
import CropDialog from '../media/CropDialog.vue'
import { SAMPLE_MEDIA_ID } from '#shared/blocks/library'
import { cloneDraft } from '#shared/clone'
import type { FieldIssue } from '#shared/issues'
import FieldErrors from './FieldErrors.vue'

const props = withDefaults(
  defineProps<{
    type: string
    modelValue: Record<string, unknown>
    issues?: FieldIssue[]
    basePath?: string
  }>(),
  { issues: () => [], basePath: '' },
)

const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>] }>()

const fields = computed(() => fieldsForBlock(props.type))

function get(path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), props.modelValue)
}

function issuePath(path: string): string {
  return props.basePath ? `${props.basePath}.${path}` : path
}

function set(path: string, value: unknown) {
  const next = cloneDraft(props.modelValue)
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
  if (!id || previews.value[id] || id === SAMPLE_MEDIA_ID) return
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

function collectMediaIds(value: unknown, acc: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaIds(item, acc)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (typeof record.media === 'string' && record.media) acc.push(record.media)
  else for (const item of Object.values(record)) collectMediaIds(item, acc)
}

watch(
  () => props.modelValue,
  () => {
    const ids: string[] = []
    collectMediaIds(props.modelValue, ids)
    for (const id of ids) void loadPreview(id)
  },
  { immediate: true, deep: true },
)

function fieldAtPath(path: string): FieldSpec | undefined {
  const top = fields.value.find((f) => f.path === path)
  if (top) return top
  const match = path.match(/^([^.]+)\.(\d+)\.([^.]+)$/)
  if (!match) return undefined
  const list = fields.value.find((f) => f.path === match[1] && f.kind === 'list')
  return list?.item?.find((sub) => sub.name === match[3])
}

function slotOf(field: FieldSpec) {
  return imageSlotFor(props.type, field.path)
}

function needsCrop(item: MediaItem, ratio: string) {
  if (!item.width || !item.height) return false
  const { w, h } = parseRatio(ratio)
  return Math.abs(item.width / item.height - w / h) > 0.02
}

function onPicked(item: MediaItem) {
  const field = pickerFor.value ? fieldAtPath(pickerFor.value) : undefined
  if (!field || !pickerFor.value) return
  pick({ ...field, path: pickerFor.value }, item)
}

function pick(field: FieldSpec, item: MediaItem) {
  const next = cloneDraft(props.modelValue)
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
  // The sample photo's alt text describes the sample, not the new photo, so replace it too.
  const wasSample = textValue(`${field.path}.media`) === SAMPLE_MEDIA_ID
  apply(`${field.path}.media`, item.id)
  const currentAlt = textValue(`${field.path}.alt`)
  if ((!currentAlt || wasSample) && item.alt) apply(`${field.path}.alt`, item.alt)
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

// The crop's files are made in the background; ask the canvas to fetch the photo again now and once they are ready.
function onCropApproved() {
  cropFor.value = null
  mediaVersion.value++
  for (const ms of [1500, 4000]) setTimeout(() => mediaVersion.value++, ms)
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
      <p v-if="field.kind === 'text' && field.max && textValue(field.path).length > field.max - 15" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {{ textValue(field.path).length }} / {{ field.max }}
      </p>
      <FieldErrors v-if="field.kind === 'text'" :issues="issues" :path="issuePath(field.path)" />

      <FwbTextarea
        v-else-if="field.kind === 'textarea' || field.kind === 'richtext'"
        :model-value="field.kind === 'richtext' ? richValue(field.path) : textValue(field.path)"
        :label="field.label"
        :rows="field.kind === 'richtext' ? 6 : 3"
        @update:model-value="field.kind === 'richtext' ? setRich(field.path, String($event)) : set(field.path, $event)"
      />
      <FieldErrors v-if="field.kind === 'textarea' || field.kind === 'richtext'" :issues="issues" :path="issuePath(field.path)" include-children />

      <FwbSelect
        v-else-if="field.kind === 'enum'"
        :model-value="textValue(field.path)"
        :label="field.label"
        :options="(field.options ?? []).map((o) => ({ value: o, name: o.replace(/-/g, ' ') }))"
        @update:model-value="set(field.path, $event)"
      />
      <FieldErrors v-if="field.kind === 'enum'" :issues="issues" :path="issuePath(field.path)" />

      <label v-else-if="field.kind === 'boolean'" class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
        <input type="checkbox" :checked="Boolean(get(field.path))" @change="set(field.path, ($event.target as HTMLInputElement).checked)">
        {{ field.label }}
      </label>
      <FieldErrors v-if="field.kind === 'boolean'" :issues="issues" :path="issuePath(field.path)" />

      <div v-else-if="field.kind === 'link'" class="rounded-md border border-gray-200 dark:border-gray-700 p-3">
        <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{{ field.label }}</p>
        <div class="flex flex-col gap-2">
          <FwbInput :model-value="textValue(`${field.path}.label`)" label="Label" @update:model-value="set(`${field.path}.label`, $event)" />
          <FwbInput :model-value="textValue(`${field.path}.href`)" label="Link" @update:model-value="set(`${field.path}.href`, $event)" />
        </div>
        <FieldErrors :issues="issues" :path="issuePath(field.path)" include-children />
      </div>

      <div v-else-if="field.kind === 'image'" class="rounded-md border border-gray-200 dark:border-gray-700 p-3">
        <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{{ field.label }}</p>
        <img
          v-if="previewOf(field.path)?.src"
          :src="previewOf(field.path)!.src!"
          :alt="textValue(`${field.path}.alt`) || previewOf(field.path)?.alt || ''"
          class="mb-2 max-h-40 w-full rounded object-cover"
        />
        <p v-else-if="textValue(`${field.path}.media`) === SAMPLE_MEDIA_ID" class="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">Sample photo. Choose a real one with Change before submitting.</p>
        <p v-else-if="textValue(`${field.path}.media`)" class="mb-2 text-xs text-gray-500 dark:text-gray-400">Photo {{ textValue(`${field.path}.media`) }}</p>
        <p v-else class="mb-2 text-xs text-gray-500 dark:text-gray-400">No photo yet.</p>
        <div class="mb-2 flex flex-wrap gap-2">
          <FwbButton size="sm" color="light" type="button" @click="pickerFor = field.path">Change</FwbButton>
          <FwbButton v-if="textValue(`${field.path}.media`) && slotOf(field)" size="sm" color="light" type="button" @click="openCrop(field)">Crop</FwbButton>
        </div>
        <FwbInput :model-value="textValue(`${field.path}.alt`)" label="Alt text" @update:model-value="set(`${field.path}.alt`, $event)" />
        <FieldErrors :issues="issues" :path="issuePath(`${field.path}.alt`)" />
        <FieldErrors :issues="issues" :path="issuePath(field.path)" />
      </div>

      <FwbInput
        v-else-if="field.kind === 'media' || field.kind === 'embed'"
        :model-value="textValue(field.path)"
        :label="field.label"
        @update:model-value="set(field.path, $event)"
      />
      <FieldErrors v-if="field.kind === 'media' || field.kind === 'embed'" :issues="issues" :path="issuePath(field.path)" />

      <div v-else-if="field.kind === 'list'" class="rounded-md border border-gray-200 dark:border-gray-700 p-3">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ field.label }}</p>
          <button type="button" class="text-sm text-blue-700 dark:text-blue-400 hover:underline" @click="addItem(field)">Add</button>
        </div>
        <FieldErrors :issues="issues" :path="issuePath(field.path)" />
        <div v-for="(item, index) in listItems(field)" :key="index" class="mb-3 border-b border-gray-100 dark:border-gray-800 pb-3 last:mb-0 last:border-0 last:pb-0">
          <FieldErrors :issues="issues" :path="issuePath(`${field.path}.${index}`)" />
          <div v-for="sub in field.item ?? []" :key="sub.name" class="mb-2">
            <FwbTextarea
              v-if="sub.kind === 'richtext' || sub.kind === 'textarea'"
              :model-value="sub.kind === 'richtext' ? richTextToPlain((item[sub.name] as RichTextDoc) ?? { type: 'doc', content: [] }) : String(item[sub.name] ?? '')"
              :label="sub.label"
              :rows="sub.name === 'badgeHtml' ? 5 : 3"
              @update:model-value="updateItem(field, index, sub.name, sub.kind === 'richtext' ? richTextFromParagraphs(String($event).split(/\n+/)) : $event)"
            />
            <p v-if="sub.name === 'badgeHtml'" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Optional. Only scripts and images from known hosts (Charity Navigator, Candid, TripAdvisor and similar) are kept. Inline scripts are removed. Prefer an uploaded logo when you can.
            </p>
            <label v-else-if="sub.kind === 'boolean'" class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" :checked="Boolean(item[sub.name])" @change="updateItem(field, index, sub.name, ($event.target as HTMLInputElement).checked)">
              {{ sub.label }}
            </label>
            <div v-else-if="sub.kind === 'link'" class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
              <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{{ sub.label }}</p>
              <FwbInput :model-value="String((item[sub.name] as { label?: string } | undefined)?.label ?? '')" label="Label" @update:model-value="updateItem(field, index, sub.name, { ...((item[sub.name] as object) ?? {}), label: $event, href: (item[sub.name] as { href?: string } | undefined)?.href ?? '' })" />
              <FwbInput class="mt-2" :model-value="String((item[sub.name] as { href?: string } | undefined)?.href ?? '')" label="Link" @update:model-value="updateItem(field, index, sub.name, { ...((item[sub.name] as object) ?? {}), href: $event, label: (item[sub.name] as { label?: string } | undefined)?.label ?? '' })" />
            </div>
            <div v-else-if="sub.kind === 'image'" class="rounded-md border border-gray-200 dark:border-gray-700 p-2">
              <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">{{ sub.label }}</p>
              <img
                v-if="previewOf(`${field.path}.${index}.${sub.name}`)?.src"
                :src="previewOf(`${field.path}.${index}.${sub.name}`)!.src!"
                :alt="String((item[sub.name] as { alt?: string } | undefined)?.alt ?? '')"
                class="mb-2 max-h-24 w-auto rounded object-contain bg-gray-50 dark:bg-gray-900"
              >
              <p v-else class="mb-2 text-xs text-gray-500 dark:text-gray-400">No logo or photo yet.</p>
              <div class="mb-2 flex flex-wrap gap-2">
                <FwbButton size="sm" color="light" type="button" @click="pickerFor = `${field.path}.${index}.${sub.name}`">Change</FwbButton>
                <FwbButton v-if="textValue(`${field.path}.${index}.${sub.name}.media`) && slotOf({ ...sub, path: `${field.path}.${index}.${sub.name}` })" size="sm" color="light" type="button" @click="openCrop({ ...sub, path: `${field.path}.${index}.${sub.name}` })">Crop</FwbButton>
              </div>
              <FwbInput :model-value="String((item[sub.name] as { alt?: string } | undefined)?.alt ?? '')" label="Alt text" @update:model-value="updateItem(field, index, sub.name, { ...((item[sub.name] as object) ?? {}), alt: $event, media: (item[sub.name] as { media?: string } | undefined)?.media ?? '' })" />
              <FieldErrors :issues="issues" :path="issuePath(`${field.path}.${index}.${sub.name}.alt`)" />
              <FieldErrors :issues="issues" :path="issuePath(`${field.path}.${index}.${sub.name}`)" />
            </div>
            <FwbInput
              v-else
              :model-value="String(item[sub.name] ?? '')"
              :label="sub.label"
              @update:model-value="updateItem(field, index, sub.name, $event)"
            />
            <FieldErrors :issues="issues" :path="issuePath(`${field.path}.${index}.${sub.name}`)" include-children />
          </div>
          <button type="button" class="text-xs text-red-700 dark:text-red-400 hover:underline" @click="removeItem(field, index)">Remove</button>
        </div>
      </div>
    </div>
    <MediaPickerModal v-if="pickerFor" :selected-id="pickerFor ? textValue(`${pickerFor}.media`) : null" @close="pickerFor = null" @pick="onPicked($event)" />
    <CropDialog v-if="cropFor" :media-id="cropFor.mediaId" :ratio="cropFor.ratio" :title="cropFor.title" @close="cropFor = null" @approved="onCropApproved" />
  </div>
</template>
