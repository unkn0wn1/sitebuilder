<script setup lang="ts">
import { fieldsForBlock, type FieldSpec } from '../../utils/block-fields'
import { richTextFromParagraphs, richTextToPlain, type RichTextDoc } from '#shared/richtext'

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
        <FwbInput :model-value="textValue(`${field.path}.media`)" label="Media id" @update:model-value="set(`${field.path}.media`, $event)" />
        <div class="mt-2">
          <FwbInput :model-value="textValue(`${field.path}.alt`)" label="Alt text" @update:model-value="set(`${field.path}.alt`, $event)" />
        </div>
        <p class="mt-2 text-xs text-gray-500">The media library will let you change or crop this photo later.</p>
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
  </div>
</template>
