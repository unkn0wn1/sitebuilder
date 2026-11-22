<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'

const emit = defineEmits<{ message: [text: string]; error: [text: string] }>()
interface Hook {
  url: string | null
  events: string[]
  secretSet: boolean
  allEvents: { key: string; label: string }[]
}
const loading = ref(true)
const saving = ref(false)
const hook = ref<Hook | null>(null)
const view = computed<Hook>(() => hook.value ?? { url: null, events: [], secretSet: false, allEvents: [] })
const url = ref('')
const events = ref<string[]>([])
const secret = ref('')
const clearSecret = ref(false)

async function load() {
  loading.value = true
  try {
    const loaded = await api<Hook>('/agent/webhook')
    hook.value = loaded
    url.value = loaded.url ?? ''
    events.value = [...loaded.events]
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not load alert settings.')
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  try {
    const body: Record<string, unknown> = { url: url.value.trim() || null, events: events.value }
    if (secret.value) body.secret = secret.value
    else if (clearSecret.value) body.secret = null
    const saved = await api<Hook>('/agent/webhook', { method: 'PUT', body })
    hook.value = saved
    secret.value = ''
    clearSecret.value = false
    emit('message', saved.url ? 'Alert settings saved.' : 'Alerts are off.')
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not save alert settings.')
  } finally {
    saving.value = false
  }
}
async function sendTest() {
  try {
    await api('/agent/webhook/test', { method: 'POST', body: {} })
    emit('message', 'A test alert is on its way. It can take a few seconds.')
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not send a test.')
  }
}
function toggle(key: string, on: boolean) {
  events.value = on ? [...new Set([...events.value, key])] : events.value.filter((e) => e !== key)
}
onMounted(load)
</script>

<template>
  <div>
    <p class="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Send a short message to an address you choose when an agent does something you want to hear about right away. Owners and admins are always emailed about publishes and approval requests as well.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading…</p>
    <form v-else-if="hook" class="max-w-2xl space-y-4" @submit.prevent="save">
      <FwbInput v-model="url" label="Alert address (https)" placeholder="https://hooks.example.org/agent-alerts" />
      <fieldset class="min-w-0 border-0 p-0">
        <legend class="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Tell me when</legend>
        <label v-for="e in view.allEvents" :key="e.key" class="mb-2 flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" class="mt-0.5 rounded border-gray-300 dark:border-gray-600" :checked="events.includes(e.key)" @change="toggle(e.key, ($event.target as HTMLInputElement).checked)" />
          <span>{{ e.label }}</span>
        </label>
      </fieldset>
      <div>
        <FwbInput v-model="secret" type="password" :label="view.secretSet ? 'Signing secret (set; type a new one to replace it)' : 'Signing secret (optional, 8+ characters)'" autocomplete="off" />
        <p class="mt-1 mb-0 text-sm text-gray-500 dark:text-gray-400">If set, each alert carries an <code>x-sitebuilder-signature</code> header (HMAC-SHA256 of "timestamp.body") so the receiver can check it came from here. It is stored encrypted and never shown again.</p>
        <label v-if="view.secretSet" class="mt-2 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="clearSecret" type="checkbox" /> Remove the secret (send unsigned)</label>
      </div>
      <p class="m-0 text-sm text-gray-600 dark:text-gray-400">Alerts carry names, change titles and ids, never tokens, secrets or page text. Addresses inside a private network are refused, and redirects are not followed.</p>
      <div class="flex flex-wrap gap-2">
        <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
        <FwbButton type="button" color="light" :disabled="!view.url" @click="sendTest">Send a test alert</FwbButton>
      </div>
    </form>
  </div>
</template>
