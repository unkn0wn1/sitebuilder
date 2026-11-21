<script setup lang="ts">
import { richTextFromParagraphs, richTextToPlain } from '#shared/richtext'
import { SOCIAL_NETWORKS, type FooterDoc } from '#shared/site-parts'
import { type SitePartListItem } from '../../utils/site-parts'
import SocialRow from './SocialRow.vue'
import { cloneDraft } from '#shared/clone'

const props = defineProps<{
  modelValue: FooterDoc
  menus: SitePartListItem[]
}>()
const emit = defineEmits<{ 'update:modelValue': [FooterDoc] }>()

const NONE = '__none__'
const menuOptions = computed(() => [
  { name: 'None', value: NONE },
  ...props.menus.filter((m) => m.kind === 'menu').map((m) => ({ name: m.label, value: m.key })),
])

const unusedNetworks = computed(() => SOCIAL_NETWORKS.filter((n) => !props.modelValue.social.some((s) => s.network === n)))

function patch(update: Partial<FooterDoc>) {
  emit('update:modelValue', { ...props.modelValue, ...update })
}

function setText(value: string) {
  const paragraphs = value.split('\n').map((line) => line.trim()).filter(Boolean)
  patch({ text: paragraphs.length ? richTextFromParagraphs(paragraphs) : null })
}

function setContact(field: 'email' | 'phone' | 'address', value: string) {
  const next = value.trim() ? value : null
  patch({ contact: { ...props.modelValue.contact, [field]: next } })
}

function setLegal(key: string) {
  patch({ legalMenuKey: !key || key === NONE ? null : key })
}

function addSocial() {
  const network = unusedNetworks.value[0]
  if (!network) return
  patch({ social: [...props.modelValue.social, { network, url: 'https://' }] })
}

function setSocial(index: number, update: { network?: (typeof SOCIAL_NETWORKS)[number]; url?: string }) {
  const social = cloneDraft(props.modelValue.social)
  const row = social[index]
  if (!row) return
  if (update.network) row.network = update.network
  if (update.url !== undefined) row.url = update.url
  patch({ social })
}

function removeSocial(index: number) {
  patch({ social: props.modelValue.social.filter((_, i) => i !== index) })
}
</script>

<template>
  <div class="space-y-4">
    <UiSection title="Colour" icon="footer">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-gray-900 dark:text-white">Background</span>
        <UiSegmented
          :model-value="modelValue.appearance ?? 'light'"
          :options="[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]"
          label="Footer background"
          @update:model-value="patch({ appearance: $event === 'dark' ? 'dark' : 'light' })"
        />
      </div>
      <p class="m-0 text-xs text-gray-500 dark:text-gray-400">A dark footer uses the dark-background logo from Brand and Design.</p>
    </UiSection>

    <UiSection title="About and contact">
      <div>
        <label class="mb-2 block text-sm font-medium text-gray-900 dark:text-white">About this organisation</label>
        <textarea
          class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          rows="3"
          :value="modelValue.text ? richTextToPlain(modelValue.text) : ''"
          @input="setText(($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <FwbInput :model-value="modelValue.contact.email ?? ''" label="Email" type="email" @update:model-value="setContact('email', String($event))" />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FwbInput :model-value="modelValue.contact.phone ?? ''" label="Phone" @update:model-value="setContact('phone', String($event))" />
        <FwbInput :model-value="modelValue.charityNumber ?? ''" label="Charity number" @update:model-value="patch({ charityNumber: String($event).trim() || null })" />
      </div>
      <FwbInput :model-value="modelValue.contact.address ?? ''" label="Address" @update:model-value="setContact('address', String($event))" />
      <FwbSelect :model-value="modelValue.legalMenuKey ?? NONE" :options="menuOptions" label="Legal menu (privacy, terms)" @update:model-value="setLegal(String($event))" />
    </UiSection>

    <UiSection title="Social links" :description="`${modelValue.social.length} of ${SOCIAL_NETWORKS.length}`">
      <SocialRow
        v-for="(row, index) in modelValue.social"
        :key="`${row.network}-${index}`"
        :row="row"
        :unused="unusedNetworks"
        @change="setSocial(index, $event)"
        @remove="removeSocial(index)"
      />
      <FwbButton size="sm" color="light" :disabled="!unusedNetworks.length" @click="addSocial">
        <span class="inline-flex items-center gap-1.5"><UiIcon name="plus" :size="14" /> Add social link</span>
      </FwbButton>
    </UiSection>
  </div>
</template>
