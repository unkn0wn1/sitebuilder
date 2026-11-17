<script setup lang="ts">
import { richTextFromParagraphs, richTextToPlain } from '#shared/richtext'
import { SOCIAL_NETWORKS, type FooterDoc } from '#shared/site-parts'
import { type SitePartListItem } from '../../utils/site-parts'
import SocialRow from './SocialRow.vue'

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
  const social = structuredClone(props.modelValue.social)
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
  <div class="space-y-6">
    <div>
      <label class="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">About this organisation</label>
      <textarea
        class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 p-2.5 text-sm"
        rows="4"
        :value="modelValue.text ? richTextToPlain(modelValue.text) : ''"
        @input="setText(($event.target as HTMLTextAreaElement).value)"
      />
    </div>
    <FwbInput :model-value="modelValue.contact.email ?? ''" label="Email" type="email" @update:model-value="setContact('email', String($event))" />
    <FwbInput :model-value="modelValue.contact.phone ?? ''" label="Phone" @update:model-value="setContact('phone', String($event))" />
    <FwbInput :model-value="modelValue.contact.address ?? ''" label="Address" @update:model-value="setContact('address', String($event))" />
    <FwbSelect
      :model-value="modelValue.legalMenuKey ?? NONE"
      :options="menuOptions"
      label="Legal menu (privacy, terms)"
      @update:model-value="setLegal(String($event))"
    />
    <FwbInput :model-value="modelValue.charityNumber ?? ''" label="Charity number" @update:model-value="patch({ charityNumber: String($event).trim() || null })" />
    <div class="space-y-3">
      <p class="text-sm font-medium text-gray-800 dark:text-gray-200">Social links</p>
      <SocialRow
        v-for="(row, index) in modelValue.social"
        :key="`${row.network}-${index}`"
        :row="row"
        :unused="unusedNetworks"
        @change="setSocial(index, $event)"
        @remove="removeSocial(index)"
      />
      <FwbButton size="sm" color="light" :disabled="!unusedNetworks.length" @click="addSocial">Add social link</FwbButton>
    </div>
  </div>
</template>
