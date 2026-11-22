<script setup lang="ts">
import { canvasImageUrl } from '../../utils/media'
import { newId } from '#shared/ids'
import type { LinkTarget, MenuDoc } from '#shared/site-parts'
import type { ImageRef } from '#shared/blocks/define'
import type { MediaItem } from '../../utils/media'
import MediaPickerModal from '../media/MediaPickerModal.vue'
import type { PageOption } from '../../utils/site-parts'
import LinkTargetField from './LinkTargetField.vue'
import { cloneDraft } from '#shared/clone'

const props = defineProps<{ modelValue: MenuDoc; pages: PageOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [MenuDoc]; focus: [index: number | null] }>()

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
  const items = cloneDraft(props.modelValue.items)
  const item = items[index]
  if (!item || item.children.length >= 12) return
  item.children.push({ id: newId('block'), label: 'New item', target: defaultTarget.value })
  emitDoc(items)
}

function removeItem(index: number) {
  emitDoc(props.modelValue.items.filter((_, i) => i !== index))
}

function removeChild(index: number, childIndex: number) {
  const items = cloneDraft(props.modelValue.items)
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
  const items = cloneDraft(props.modelValue.items)
  const item = items[index]
  if (!item) return
  const next = childIndex + delta
  if (next < 0 || next >= item.children.length) return
  const [row] = item.children.splice(childIndex, 1)
  item.children.splice(next, 0, row!)
  emitDoc(items)
}

function setItem(index: number, patch: { label?: string; target?: LinkTarget }) {
  const items = cloneDraft(props.modelValue.items)
  const item = items[index]
  if (!item) return
  if (patch.label !== undefined) item.label = patch.label
  if (patch.target) item.target = patch.target
  emitDoc(items)
}

function setChild(index: number, childIndex: number, patch: { label?: string; target?: LinkTarget; featured?: boolean; image?: ImageRef | null }) {
  const items = cloneDraft(props.modelValue.items)
  const child = items[index]?.children[childIndex]
  if (!child) return
  if (patch.label !== undefined) child.label = patch.label
  if (patch.target) child.target = patch.target
  if (patch.featured !== undefined) {
    if (patch.featured) child.featured = true
    else {
      delete child.featured
      delete child.image
    }
  }
  if (patch.image !== undefined) {
    if (patch.image) child.image = patch.image
    else delete child.image
  }
  emitDoc(items)
}

// Tiles render only in a mega header. The menu screen does not load that header, so the control stays available with a hint.
const FEATURED_MAX = 5
const featuredCount = (index: number) => props.modelValue.items[index]?.children.filter((c) => c.featured).length ?? 0
const picking = ref<{ index: number; childIndex: number } | null>(null)
const pickingImageId = computed(() => {
  const at = picking.value
  if (!at) return null
  return props.modelValue.items[at.index]?.children[at.childIndex]?.image?.media ?? null
})

function onPick(item: MediaItem) {
  const at = picking.value
  picking.value = null
  if (!at) return
  const label = props.modelValue.items[at.index]?.children[at.childIndex]?.label ?? ''
  const image: ImageRef = { media: item.id }
  if (item.decorative) image.decorative = true
  else image.alt = item.alt?.trim() || label
  setChild(at.index, at.childIndex, { image })
}

function setAlt(index: number, childIndex: number, alt: string) {
  const image = props.modelValue.items[index]?.children[childIndex]?.image
  if (image) setChild(index, childIndex, { image: { ...image, alt } })
}
</script>

<template>
  <div class="space-y-3">
    <UiEmptyState v-if="!modelValue.items.length" icon="list" title="This menu is empty" description="Add the first link. Links to pages on this site follow the page if it moves.">
      <FwbButton size="sm" @click="addItem">Add the first link</FwbButton>
    </UiEmptyState>
    <ol class="m-0 list-none space-y-3 p-0">
      <li
        v-for="(item, index) in modelValue.items"
        :key="item.id"
        class="rounded-xl border border-gray-200/90 bg-white dark:border-gray-800 dark:bg-gray-900"
        @focusin="emit('focus', index)"
      >
        <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
          <span class="grid size-6 shrink-0 place-items-center rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{{ index + 1 }}</span>
          <input
            :value="item.label"
            class="min-w-0 flex-1 rounded-md border-0 bg-transparent px-1 py-1 text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 dark:text-white"
            :aria-label="`Menu item ${index + 1} label`"
            @input="setItem(index, { label: ($event.target as HTMLInputElement).value })"
          />
          <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800" title="Move up" :disabled="index === 0" @click="moveItem(index, -1)"><UiIcon name="up" :size="15" /></button>
          <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800" title="Move down" :disabled="index === modelValue.items.length - 1" @click="moveItem(index, 1)"><UiIcon name="downArrow" :size="15" /></button>
          <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Remove" @click="removeItem(index)"><UiIcon name="trash" :size="15" /></button>
        </div>
        <div class="space-y-3 p-3">
          <LinkTargetField :model-value="item.target" :pages="pages" @update:model-value="setItem(index, { target: $event })" />
          <p v-if="item.children.length" class="m-0 text-xs text-gray-500 dark:text-gray-400">Photo tiles show beside the links when the header menu look is Mega.</p>
          <p v-if="featuredCount(index) >= FEATURED_MAX" class="m-0 text-xs text-amber-800 dark:text-amber-200">Feature at most 5 tiles per menu item.</p>
          <ol v-if="item.children.length" class="m-0 list-none space-y-2 border-l-2 border-gray-100 p-0 pl-3 dark:border-gray-800">
            <li v-for="(child, childIndex) in item.children" :key="child.id" class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
              <div class="flex items-center gap-1.5">
                <input
                  :value="child.label"
                  class="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  :aria-label="`Sub-item ${childIndex + 1} of ${item.label}`"
                  @input="setChild(index, childIndex, { label: ($event.target as HTMLInputElement).value })"
                />
                <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-white disabled:opacity-30 dark:hover:bg-gray-900" title="Move up" :disabled="childIndex === 0" @click="moveChild(index, childIndex, -1)"><UiIcon name="up" :size="14" /></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-white disabled:opacity-30 dark:hover:bg-gray-900" title="Move down" :disabled="childIndex === item.children.length - 1" @click="moveChild(index, childIndex, 1)"><UiIcon name="downArrow" :size="14" /></button>
                <button type="button" class="grid size-7 place-items-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Remove" @click="removeChild(index, childIndex)"><UiIcon name="trash" :size="14" /></button>
              </div>
              <div class="mt-2 space-y-2">
                <LinkTargetField :model-value="child.target" :pages="pages" @update:model-value="setChild(index, childIndex, { target: $event })" />
                <label class="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    class="rounded text-blue-600"
                    :checked="!!child.featured"
                    :disabled="!child.featured && featuredCount(index) >= FEATURED_MAX"
                    @change="setChild(index, childIndex, { featured: ($event.target as HTMLInputElement).checked })"
                  />
                  Show as a photo tile
                </label>
                <div v-if="child.featured" class="flex flex-wrap items-center gap-2">
                  <img v-if="child.image" :src="canvasImageUrl(child.image.media, 640)" :alt="child.image.alt ?? ''" class="h-12 w-16 rounded-md bg-gray-200 object-cover dark:bg-gray-700" @error="($event.target as HTMLImageElement).style.opacity = '0.2'">
                  <FwbButton size="xs" color="light" @click="picking = { index, childIndex }">{{ child.image ? 'Change photo' : 'Add a photo' }}</FwbButton>
                  <FwbButton v-if="child.image" size="xs" color="light" @click="setChild(index, childIndex, { image: null })">Remove photo</FwbButton>
                  <FwbInput v-if="child.image" :model-value="child.image.alt ?? ''" class="min-w-40 flex-1" size="sm" placeholder="Describe the photo" @update:model-value="setAlt(index, childIndex, String($event))" />
                </div>
              </div>
            </li>
          </ol>
          <button type="button" class="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-blue-700 hover:underline disabled:opacity-40 dark:text-blue-300" :disabled="item.children.length >= 12" @click="addChild(index)">
            <UiIcon name="plus" :size="14" /> Add a sub-item
          </button>
        </div>
      </li>
    </ol>
    <FwbButton v-if="modelValue.items.length" size="sm" color="light" :disabled="modelValue.items.length >= 12" @click="addItem">
      <span class="inline-flex items-center gap-1.5"><UiIcon name="plus" :size="14" /> Add a menu item</span>
    </FwbButton>
    <p v-if="modelValue.items.length >= 12" class="text-xs text-gray-500 dark:text-gray-400">A menu can have 12 top-level items. Put the rest in sub-menus.</p>
    <MediaPickerModal v-if="picking" :selected-id="pickingImageId" @close="picking = null" @pick="onPick" />
  </div>
</template>
