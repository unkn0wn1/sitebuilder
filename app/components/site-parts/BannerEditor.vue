<script setup lang="ts">
import type { BannerDoc, LinkTarget } from '#shared/site-parts'
import type { PageOption } from '../../utils/site-parts'
import LinkTargetField from './LinkTargetField.vue'

const props = defineProps<{ modelValue: BannerDoc; pages: PageOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [BannerDoc] }>()

function patch(update: Partial<BannerDoc>) {
  emit('update:modelValue', { ...props.modelValue, ...update })
}

function setLink(on: boolean) {
  if (on) {
    const first = props.pages[0]
    patch({
      link: {
        label: 'Learn more',
        target: first ? { type: 'page', pageId: first.id } : { type: 'url', url: 'https://' },
      },
    })
  } else {
    patch({ link: null })
  }
}

function setLinkLabel(label: string) {
  if (!props.modelValue.link) return
  patch({ link: { ...props.modelValue.link, label } })
}

function setLinkTarget(target: LinkTarget) {
  if (!props.modelValue.link) return
  patch({ link: { ...props.modelValue.link, target } })
}
</script>

<template>
  <div class="space-y-6">
    <label class="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
      <input type="checkbox" class="rounded text-blue-700 dark:text-blue-400" :checked="modelValue.enabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })" />
      Show this banner on every page
    </label>
    <FwbInput :model-value="modelValue.message" label="Message" @update:model-value="patch({ message: String($event) })" />
    <FwbSelect
      :model-value="modelValue.tone"
      label="Tone"
      :options="[
        { name: 'Information', value: 'info' },
        { name: 'Urgent', value: 'urgent' },
        { name: 'Celebrate', value: 'celebrate' },
      ]"
      @update:model-value="patch({ tone: $event === 'urgent' || $event === 'celebrate' ? $event : 'info' })"
    />
    <div class="space-y-3">
      <label class="inline-flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
        <input type="checkbox" class="rounded text-blue-700 dark:text-blue-400" :checked="!!modelValue.link" @change="setLink(($event.target as HTMLInputElement).checked)" />
        Include a link
      </label>
      <div v-if="modelValue.link" class="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
        <FwbInput :model-value="modelValue.link.label" label="Link text" @update:model-value="setLinkLabel(String($event))" />
        <LinkTargetField :model-value="modelValue.link.target" :pages="pages" label="Link goes to" @update:model-value="setLinkTarget" />
      </div>
    </div>
  </div>
</template>
