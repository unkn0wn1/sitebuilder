<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import type { AgentTokenItem } from '../../../utils/agents'
import SimpleModal from '../../builder/SimpleModal.vue'

const props = defineProps<{ token: AgentTokenItem; siteName: string }>()
const emit = defineEmits<{ close: []; done: [message: string] }>()

const kind = ref<'1' | '3' | '7' | 'permanent'>('3')
const typedName = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

const nameMatches = computed(() => typedName.value.trim() === props.siteName)
const ready = computed(() => nameMatches.value && password.value.length > 0 && !busy.value)

async function enable() {
  busy.value = true
  error.value = ''
  try {
    const body = { siteName: typedName.value.trim(), password: password.value, ...(kind.value === 'permanent' ? { permanent: true } : { days: Number(kind.value) }) }
    await api(`/agent/tokens/${props.token.id}/always-allow`, { method: 'POST', body })
    emit('done', kind.value === 'permanent' ? `Always-allow is ON for "${props.token.name}" with no end date.` : `Always-allow is ON for "${props.token.name}" for ${kind.value} day${kind.value === '1' ? '' : 's'}.`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not switch it on.'
  } finally {
    busy.value = false
    password.value = ''
  }
}
</script>

<template>
  <SimpleModal title="Always-allow" @close="emit('close')">
    <form id="always-allow-form" class="space-y-4" @submit.prevent="enable">
      <p class="m-0 text-sm text-gray-700 dark:text-gray-300">
        Always-allow lets <strong>{{ token.name }}</strong> publish a change that no rule covers, without waiting for a person. Donation forms and embeds, money sections, someone else's unpublished work and failing checks still need a person. A "refuse" rule still refuses.
      </p>
      <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
      <fieldset class="min-w-0 border-0 p-0">
        <legend class="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">How long</legend>
        <div class="space-y-2">
          <label v-for="o in [{ v: '1', t: '1 day' }, { v: '3', t: '3 days' }, { v: '7', t: '7 days' }]" :key="o.v" class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input v-model="kind" type="radio" name="how-long" :value="o.v" /> {{ o.t }} <span class="text-gray-500 dark:text-gray-400">(switches itself off)</span>
          </label>
          <label class="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input v-model="kind" type="radio" name="how-long" value="permanent" class="mt-0.5" />
            <span><strong>Permanent</strong> <span class="text-gray-500 dark:text-gray-400">(no end date: stays on until you switch it off or revoke the token)</span></span>
          </label>
        </div>
      </fieldset>
      <FwbAlert v-if="kind === 'permanent'" type="warning">A permanent setting is easy to forget. It will show as "permanent" in the token list. Give the token an IP list and an expiry date, and keep refuse rules on pages that must never change without a person.</FwbAlert>
      <FwbInput v-model="typedName" :label="`Type the site name to confirm: ${siteName}`" autocomplete="off" />
      <FwbInput v-model="password" type="password" label="Your password" autocomplete="current-password" />
    </form>
    <template #footer>
      <div class="flex gap-2">
        <FwbButton type="submit" form="always-allow-form" :disabled="!ready">{{ busy ? 'Switching on…' : kind === 'permanent' ? 'Switch on permanently' : 'Switch on' }}</FwbButton>
        <FwbButton color="light" type="button" @click="emit('close')">Cancel</FwbButton>
      </div>
    </template>
  </SimpleModal>
</template>
