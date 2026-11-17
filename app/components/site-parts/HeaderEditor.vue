<script setup lang="ts">
import type { HeaderDoc, LinkTarget } from '#shared/site-parts'
import type { PageOption, SitePartListItem } from '../../utils/site-parts'
import LinkTargetField from './LinkTargetField.vue'

const props = defineProps<{
  modelValue: HeaderDoc
  pages: PageOption[]
  menus: SitePartListItem[]
}>()
const emit = defineEmits<{ 'update:modelValue': [HeaderDoc] }>()

const menuOptions = computed(() => props.menus.filter((m) => m.kind === 'menu').map((m) => ({ name: m.label, value: m.key })))

function patch(update: Partial<HeaderDoc>) {
  emit('update:modelValue', { ...props.modelValue, ...update })
}

function setCta(on: boolean) {
  if (on) {
    const first = props.pages[0]
    patch({
      cta: {
        label: 'Donate',
        target: first ? { type: 'page', pageId: first.id } : { type: 'url', url: 'https://' },
      },
    })
  } else {
    patch({ cta: null })
  }
}

function setCtaLabel(label: string) {
  if (!props.modelValue.cta) return
  patch({ cta: { ...props.modelValue.cta, label } })
}

function setCtaTarget(target: LinkTarget) {
  if (!props.modelValue.cta) return
  patch({ cta: { ...props.modelValue.cta, target } })
}

</script>

<template>
  <div class="space-y-6">
    <FwbSelect
      :model-value="modelValue.style"
      :options="[
        { name: 'Simple — logo and menu in a row', value: 'simple' },
        { name: 'Centred — logo above the menu', value: 'centred' },
      ]"
      label="Layout"
      @update:model-value="patch({ style: $event === 'centred' ? 'centred' : 'simple' })"
    />
    <FwbSelect
      :model-value="modelValue.menuKey"
      :options="menuOptions.length ? menuOptions : [{ name: 'No menus yet', value: modelValue.menuKey }]"
      label="Menu"
      @update:model-value="patch({ menuKey: String($event) })"
    />
    <div class="space-y-3">
      <label class="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
        <input type="checkbox" class="rounded text-blue-700" :checked="!!modelValue.cta" @change="setCta(($event.target as HTMLInputElement).checked)" />
        Show a button in the header
      </label>
      <div v-if="modelValue.cta" class="space-y-3 rounded-lg border border-gray-200 p-3">
        <FwbInput :model-value="modelValue.cta.label" label="Button text" @update:model-value="setCtaLabel(String($event))" />
        <LinkTargetField :model-value="modelValue.cta.target" :pages="pages" label="Button goes to" @update:model-value="setCtaTarget" />
      </div>
    </div>
  </div>
</template>
