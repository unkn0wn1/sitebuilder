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
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p v-if="label" class="m-0 text-sm font-medium text-gray-900 dark:text-white">{{ label }}</p>
      <UiSegmented
        :model-value="mode"
        :options="[
          { value: 'page', label: 'Page on this site' },
          { value: 'url', label: 'Web address' },
        ]"
        label="Link to"
        @update:model-value="setMode"
      />
    </div>
    <FwbSelect
      v-if="mode === 'page'"
      :model-value="modelValue.type === 'page' ? modelValue.pageId : ''"
      :options="pages.map((p) => ({ name: p.path ? `${p.title} (${p.path})` : p.title, value: p.id }))"
      @update:model-value="setPage(String($event))"
    />
    <FwbInput v-else :model-value="modelValue.type === 'url' ? modelValue.url : ''" placeholder="https://" @update:model-value="setUrl(String($event))" />
    <p v-if="draftWarning" class="m-0 text-xs text-amber-700 dark:text-amber-400">This page isn’t live yet. The link will be a warning until it is published.</p>
  </div>
</template>
