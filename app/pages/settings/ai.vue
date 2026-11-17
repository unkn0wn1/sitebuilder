<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { penceToPounds, poundsToPence } from '#shared/ai-pricing'
import type { SiteSettings } from '#shared/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const PROVIDERS = [
  { value: 'xai', name: 'xAI' },
  { value: 'openai', name: 'OpenAI' },
  { value: 'anthropic', name: 'Anthropic' },
  { value: 'custom', name: 'Custom (OpenAI-compatible)' },
] as const

const DEFAULT_MODELS: Record<string, string> = {
  xai: 'grok-4',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
  custom: '',
}

interface SettingsPayload {
  settings: SiteSettings
  secretsSet: Record<string, boolean>
}

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const saved = ref('')
const testResult = ref('')
const testError = ref('')
const keySet = ref(false)
const keyValue = ref('')

const enabled = ref(false)
const provider = ref<SiteSettings['ai']['provider']>('xai')
const baseUrl = ref('')
const model = ref('grok-4')
const smallModel = ref('')
const monthlyPounds = ref('20')
const sessionPounds = ref('2')
const requestPounds = ref('0.50')
const monthUsedPounds = ref<number | null>(null)

function poundsField(value: string, label: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number in pounds, like 20 or 0.50.`)
  const pence = poundsToPence(n)
  if (pence > 1_000_000) throw new Error(`${label} can be at most £10,000.`)
  return pence
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    const ai = data.settings.ai
    enabled.value = ai.enabled
    provider.value = ai.provider
    baseUrl.value = ai.baseUrl ?? ''
    model.value = ai.model
    smallModel.value = ai.smallModel ?? ''
    monthlyPounds.value = String(penceToPounds(ai.monthlyCapPence))
    sessionPounds.value = String(penceToPounds(ai.sessionCapPence))
    requestPounds.value = String(penceToPounds(ai.requestCapPence))
    keySet.value = !!data.secretsSet.ai_api_key
    keyValue.value = ''
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load settings.'
  }
  try {
    const status = await api<{ caps: { monthUsedPence: number } }>('/ai/status')
    monthUsedPounds.value = penceToPounds(status.caps.monthUsedPence)
  } catch {
    monthUsedPounds.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onProviderChange(value: string) {
  const next = value as SiteSettings['ai']['provider']
  const previousDefault = Object.values(DEFAULT_MODELS)
  if (!model.value || previousDefault.includes(model.value)) {
    model.value = DEFAULT_MODELS[next] ?? model.value
  }
  provider.value = next
}

async function save() {
  error.value = ''
  saved.value = ''
  testResult.value = ''
  testError.value = ''
  let monthlyCapPence: number
  let sessionCapPence: number
  let requestCapPence: number
  try {
    monthlyCapPence = poundsField(monthlyPounds.value, 'The monthly cap')
    sessionCapPence = poundsField(sessionPounds.value, 'The session cap')
    requestCapPence = poundsField(requestPounds.value, 'The request cap')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Check the caps and try again.'
    return
  }
  if (provider.value === 'custom' && !baseUrl.value.trim()) {
    error.value = 'A custom provider needs a base URL, like http://localhost:11434/v1.'
    return
  }
  if (!model.value.trim()) {
    error.value = 'Choose a model.'
    return
  }
  saving.value = true
  try {
    if (keyValue.value.trim()) {
      await api('/settings/secrets/ai_api_key', { method: 'PUT', body: { value: keyValue.value.trim() } })
      keySet.value = true
      keyValue.value = ''
    }
    await api('/settings', {
      method: 'PATCH',
      body: {
        ai: {
          enabled: enabled.value,
          provider: provider.value,
          baseUrl: baseUrl.value.trim() || null,
          model: model.value.trim(),
          smallModel: smallModel.value.trim() || null,
          monthlyCapPence,
          sessionCapPence,
          requestCapPence,
        },
      },
    })
    saved.value = 'Saved.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save those settings.'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testResult.value = ''
  testError.value = ''
  error.value = ''
  await save()
  if (error.value) return
  testing.value = true
  try {
    const result = await api<{ ok: true; model: string; reply: string }>('/settings/ai/test', { method: 'POST', body: {} })
    testResult.value = `Connected. ${result.model} replied: “${result.reply}”.`
  } catch (err) {
    testError.value = err instanceof ApiError ? err.message : "The assistant isn't available right now. Everything else works as normal."
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900">AI</h1>
      </template>
    </SettingsNav>

    <p class="mb-6 max-w-2xl text-gray-600">
      The assistant uses the key and model you provide. Draft content is sent to that provider when someone uses the assistant.
      Check the provider's data policy before you switch it on. The key is stored encrypted and is never shown again after you save it.
    </p>

    <p v-if="loading" class="text-gray-500">Loading settings…</p>

    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <FwbAlert v-if="testResult" type="success" class="mb-4">{{ testResult }}</FwbAlert>
      <FwbAlert v-if="testError" type="danger" class="mb-4">{{ testError }}</FwbAlert>

      <div class="mb-6">
        <FwbToggle v-model="enabled" label="Switch the assistant on" />
        <p class="mt-1 text-sm text-gray-500">When this is off, people can still edit pages by hand.</p>
      </div>

      <div class="mb-4">
        <FwbSelect :model-value="provider" label="Provider" :options="[...PROVIDERS]" @update:model-value="onProviderChange(String($event))" />
      </div>

      <div class="mb-4">
        <FwbInput v-model="baseUrl" label="Base URL" :placeholder="provider === 'custom' ? 'https://example.com/v1' : 'Leave blank to use the provider default'" />
        <p class="mt-1 text-sm text-gray-500">Needed for a custom or local server. For the named providers, leave this blank unless you have a reason to change it.</p>
      </div>

      <div class="mb-4">
        <FwbInput v-model="model" label="Model" placeholder="grok-4" required />
      </div>
      <div class="mb-4">
        <FwbInput v-model="smallModel" label="Cheaper model (optional)" placeholder="For small jobs such as alt text" />
      </div>

      <div class="mb-6">
        <FwbInput
          v-model="keyValue"
          type="password"
          label="API key"
          :placeholder="keySet ? 'A key is already saved. Enter a new one to replace it.' : 'Paste your API key'"
          autocomplete="off"
        />
        <p class="mt-1 text-sm text-gray-500">
          {{ keySet ? 'A key is already saved. It cannot be read back.' : 'The key is write-only: after you save it, it cannot be read back.' }}
        </p>
      </div>

      <h2 class="mb-1 text-lg font-semibold text-gray-900">Cost caps</h2>
      <p class="mb-4 text-sm text-gray-600">
        Amounts are in pounds. These are estimates used to stop a run, not invoices.
        <span v-if="monthUsedPounds !== null"> About £{{ monthUsedPounds.toFixed(2) }} has been used this month.</span>
      </p>
      <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FwbInput v-model="monthlyPounds" type="number" step="0.01" min="0" label="Monthly cap (£)" />
        <FwbInput v-model="sessionPounds" type="number" step="0.01" min="0" label="Session cap (£)" />
        <FwbInput v-model="requestPounds" type="number" step="0.01" min="0" label="Request cap (£)" />
      </div>

      <div class="flex flex-wrap gap-2">
        <FwbButton type="submit" :disabled="saving || testing">{{ saving && !testing ? 'Saving…' : 'Save' }}</FwbButton>
        <FwbButton color="light" type="button" :disabled="saving || testing" @click="testConnection">
          {{ testing ? 'Testing…' : 'Test connection' }}
        </FwbButton>
      </div>
    </form>
  </div>
</template>
