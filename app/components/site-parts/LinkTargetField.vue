<script setup lang="ts">
import type { LinkTarget } from '#shared/site-parts'
import type { PageOption } from '../../utils/site-parts'

const props = defineProps<{
  modelValue: LinkTarget
  pages: PageOption[]
  label?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [LinkTarget] }>()

const mode = computed(() => props.modelValue.type)

function setMode(type: 'page' | 'url') {
  if (type === mode.value) return
  if (type === 'page') emit('update:modelValue', { type: 'page', pageId: props.pages[0]?.id ?? '' })
  else emit('update:modelValue', { type: 'url', url: 'https://' })
}

function setPage(pageId: string) {
  emit('update:modelValue', { type: 'page', pageId })
}

function setUrl(url: string) {
  emit('update:modelValue', { type: 'url', url })
}

const selectedPage = computed(() => {
  const target = props.modelValue
  if (target.type !== 'page') return undefined
  return props.pages.find((p) => p.id === target.pageId)
})
const draftWarning = computed(() => selectedPage.value && selectedPage.value.state !== 'published')
</script>

<template>
  <div class="space-y-2">
    <p v-if="label" class="text-sm font-medium text-gray-800">{{ label }}</p>
    <div class="flex flex-wrap gap-3 text-sm">
      <label class="inline-flex items-center gap-2">
        <input type="radio" class="text-blue-700" :checked="mode === 'page'" @change="setMode('page')" />
        A page on this site
      </label>
      <label class="inline-flex items-center gap-2">
        <input type="radio" class="text-blue-700" :checked="mode === 'url'" @change="setMode('url')" />
        A web address
      </label>
    </div>
    <FwbSelect
      v-if="mode === 'page'"
      :model-value="modelValue.type === 'page' ? modelValue.pageId : ''"
      :options="pages.map((p) => ({ name: p.path ? `${p.title} (${p.path})` : p.title, value: p.id }))"
      @update:model-value="setPage(String($event))"
    />
    <FwbInput v-else :model-value="modelValue.type === 'url' ? modelValue.url : ''" placeholder="https://" @update:model-value="setUrl(String($event))" />
    <p v-if="draftWarning" class="text-sm text-amber-800">This page isn’t live yet. The link will be a warning until it is published.</p>
  </div>
</template>
