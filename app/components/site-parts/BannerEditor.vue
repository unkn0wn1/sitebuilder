<script setup lang="ts">
// The top strip's fields (message, link, colour). Its on/off switch sits in the section header around it.
import type { BannerDoc, LinkTarget } from '#shared/site-parts'
import type { PageOption } from '../../utils/site-parts'
import LinkTargetField from './LinkTargetField.vue'

const props = defineProps<{ modelValue: BannerDoc; pages: PageOption[] }>()
const emit = defineEmits<{ 'update:modelValue': [BannerDoc] }>()

function patch(update: Partial<BannerDoc>) {
  emit('update:modelValue', { ...props.modelValue, ...update })
}

function setLink(on: boolean) {
  if (on) patch({ link: { label: 'Get help', target: { type: 'url', url: 'https://' } } })
  else patch({ link: null })
}

function setLinkLabel(label: string) {
  if (props.modelValue.link) patch({ link: { ...props.modelValue.link, label } })
}

function setLinkTarget(target: LinkTarget) {
  if (props.modelValue.link) patch({ link: { ...props.modelValue.link, target } })
}

const TONES: { value: BannerDoc['tone']; label: string; swatch: string }[] = [
  { value: 'accent', label: 'Brand colour', swatch: 'bg-orange-700' },
  { value: 'info', label: 'Information', swatch: 'bg-sky-600' },
  { value: 'urgent', label: 'Urgent', swatch: 'bg-red-600' },
  { value: 'celebrate', label: 'Celebrate', swatch: 'bg-emerald-600' },
]
</script>

<template>
  <div class="space-y-4">
    <div>
      <FwbInput :model-value="modelValue.message" label="Message" placeholder="Report an ill or injured animal" @update:model-value="patch({ message: String($event) })" />
      <p class="mt-1 mb-0 text-right text-xs" :class="modelValue.message.length > 160 ? 'text-red-600' : 'text-gray-400'">{{ modelValue.message.length }}/160</p>
    </div>
    <fieldset>
      <legend class="mb-2 text-sm font-medium text-gray-900 dark:text-white">Colour</legend>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="t in TONES" :key="t.value" class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm has-[:checked]:border-blue-600 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 dark:border-gray-700">
          <input type="radio" class="sr-only" name="strip-tone" :value="t.value" :checked="modelValue.tone === t.value" @change="patch({ tone: t.value })" />
          <span class="size-4 rounded-full" :class="t.swatch" />
          <span class="text-gray-800 dark:text-gray-200">{{ t.label }}</span>
        </label>
      </div>
      <p class="mt-1.5 mb-0 text-xs text-gray-500 dark:text-gray-400">Brand colour uses the accent from Brand and Design.</p>
    </fieldset>
    <div class="space-y-3">
      <label class="inline-flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <input type="checkbox" class="rounded text-blue-600" :checked="!!modelValue.link" @change="setLink(($event.target as HTMLInputElement).checked)" />
        Add a link after the message
      </label>
      <div v-if="modelValue.link" class="space-y-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
        <FwbInput :model-value="modelValue.link.label" label="Link text" @update:model-value="setLinkLabel(String($event))" />
        <LinkTargetField :model-value="modelValue.link.target" :pages="pages" label="Link goes to" @update:model-value="setLinkTarget" />
      </div>
    </div>
  </div>
</template>
