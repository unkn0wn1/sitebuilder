<script setup lang="ts">
import { SOCIAL_NETWORKS, type FooterDoc } from '#shared/site-parts'
import { SOCIAL_LABELS } from '../../utils/site-parts'

type Social = FooterDoc['social'][number]

const props = defineProps<{
  row: Social
  unused: Array<(typeof SOCIAL_NETWORKS)[number]>
}>()

const emit = defineEmits<{
  change: [update: { network?: Social['network']; url?: string }]
  remove: []
}>()

const options = computed(() => [props.row.network, ...props.unused].map((n) => ({ name: SOCIAL_LABELS[n] ?? n, value: n })))

function onNetwork(value: string) {
  if ((SOCIAL_NETWORKS as readonly string[]).includes(value)) emit('change', { network: value as Social['network'] })
}
</script>

<template>
  <div class="flex flex-wrap items-end gap-2">
    <FwbSelect class="min-w-40" :model-value="row.network" :options="options" @update:model-value="onNetwork(String($event))" />
    <FwbInput class="min-w-56 flex-1" :model-value="row.url" placeholder="https://" @update:model-value="emit('change', { url: String($event) })" />
    <FwbButton size="sm" color="light" @click="emit('remove')">Remove</FwbButton>
  </div>
</template>
