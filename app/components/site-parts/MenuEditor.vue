<script setup lang="ts">
import { newId } from '#shared/ids'
import type { LinkTarget, MenuDoc } from '#shared/site-parts'
import type { PageOption } from '../../utils/site-parts'
import LinkTargetField from './LinkTargetField.vue'

const props = defineProps<{ modelValue: MenuDoc; pages: PageOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [MenuDoc] }>()

const defaultTarget = computed<LinkTarget>(() =>
  props.pages[0] ? { type: 'page', pageId: props.pages[0].id } : { type: 'url', url: 'https://' },
)

function emitDoc(items: MenuDoc['items']) {
  emit('update:modelValue', { schemaVersion: 1, items })
}

function addItem() {
  if (props.modelValue.items.length >= 12) return
  emitDoc([
    ...props.modelValue.items,
    { id: newId('block'), label: 'New item', target: defaultTarget.value, children: [] },
  ])
}

function addChild(index: number) {
  const items = structuredClone(props.modelValue.items)
  const item = items[index]
  if (!item || item.children.length >= 12) return
  item.children.push({ id: newId('block'), label: 'New item', target: defaultTarget.value })
  emitDoc(items)
}

function removeItem(index: number) {
  emitDoc(props.modelValue.items.filter((_, i) => i !== index))
}

function removeChild(index: number, childIndex: number) {
  const items = structuredClone(props.modelValue.items)
  const item = items[index]
  if (!item) return
  item.children = item.children.filter((_, i) => i !== childIndex)
  emitDoc(items)
}

function moveItem(index: number, delta: number) {
  const next = index + delta
  if (next < 0 || next >= props.modelValue.items.length) return
  const items = [...props.modelValue.items]
  const [row] = items.splice(index, 1)
  items.splice(next, 0, row!)
  emitDoc(items)
}

function moveChild(index: number, childIndex: number, delta: number) {
  const items = structuredClone(props.modelValue.items)
  const item = items[index]
  if (!item) return
  const next = childIndex + delta
  if (next < 0 || next >= item.children.length) return
  const [row] = item.children.splice(childIndex, 1)
  item.children.splice(next, 0, row!)
  emitDoc(items)
}

function setItem(index: number, patch: { label?: string; target?: LinkTarget }) {
  const items = structuredClone(props.modelValue.items)
  const item = items[index]
  if (!item) return
  if (patch.label !== undefined) item.label = patch.label
  if (patch.target) item.target = patch.target
  emitDoc(items)
}

function setChild(index: number, childIndex: number, patch: { label?: string; target?: LinkTarget }) {
  const items = structuredClone(props.modelValue.items)
  const child = items[index]?.children[childIndex]
  if (!child) return
  if (patch.label !== undefined) child.label = patch.label
  if (patch.target) child.target = patch.target
  emitDoc(items)
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-600">Links point at a page on this site, so they follow if the page moves. You can nest one level of sub-items.</p>
    <div v-if="!modelValue.items.length" class="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
      This menu is empty. Add a link to get started.
    </div>
    <ol class="space-y-3">
      <li v-for="(item, index) in modelValue.items" :key="item.id" class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <FwbInput :model-value="item.label" class="min-w-40 flex-1" @update:model-value="setItem(index, { label: String($event) })" />
            <div class="flex gap-1">
              <FwbButton size="sm" color="light" :disabled="index === 0" @click="moveItem(index, -1)">Up</FwbButton>
              <FwbButton size="sm" color="light" :disabled="index === modelValue.items.length - 1" @click="moveItem(index, 1)">Down</FwbButton>
              <FwbButton size="sm" color="light" :disabled="item.children.length >= 12" @click="addChild(index)">Add sub-item</FwbButton>
              <FwbButton size="sm" color="red" outline @click="removeItem(index)">Remove</FwbButton>
            </div>
          </div>
          <LinkTargetField :model-value="item.target" :pages="pages" @update:model-value="setItem(index, { target: $event })" />
        </div>
        <ol v-if="item.children.length" class="mt-3 space-y-3 border-l-2 border-gray-200 pl-4">
          <li v-for="(child, childIndex) in item.children" :key="child.id" class="rounded-md border border-gray-100 bg-gray-50 p-3">
            <div class="flex flex-col gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <FwbInput :model-value="child.label" class="min-w-40 flex-1" @update:model-value="setChild(index, childIndex, { label: String($event) })" />
                <div class="flex gap-1">
                  <FwbButton size="sm" color="light" :disabled="childIndex === 0" @click="moveChild(index, childIndex, -1)">Up</FwbButton>
                  <FwbButton size="sm" color="light" :disabled="childIndex === item.children.length - 1" @click="moveChild(index, childIndex, 1)">Down</FwbButton>
                  <FwbButton size="sm" color="red" outline @click="removeChild(index, childIndex)">Remove</FwbButton>
                </div>
              </div>
              <LinkTargetField :model-value="child.target" :pages="pages" @update:model-value="setChild(index, childIndex, { target: $event })" />
            </div>
          </li>
        </ol>
      </li>
    </ol>
    <FwbButton size="sm" :disabled="modelValue.items.length >= 12" @click="addItem">Add item</FwbButton>
    <p v-if="modelValue.items.length >= 12" class="text-sm text-gray-500">The menu can have 12 top-level items. Put the rest in sub-menus.</p>
  </div>
</template>
