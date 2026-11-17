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
  xaiOauth: { enabled: boolean; connected: boolean; account: string | null }
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

const xaiOauthEnabled = ref(false)
const xaiOauthConnected = ref(false)
const xaiOauthAccount = ref<string | null>(null)
const xaiConnecting = ref(false)
const xaiDisconnecting = ref(false)
const xaiPendingId = ref('')
const xaiUserCode = ref('')
const xaiVerificationUri = ref('')
const xaiVerificationUriComplete = ref<string | null>(null)
const xaiExpiresAt = ref(0)
const xaiPollError = ref('')
let pollTimer: ReturnType<typeof setTimeout> | null = null

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
    xaiOauthEnabled.value = !!data.xaiOauth?.enabled
    xaiOauthConnected.value = !!data.xaiOauth?.connected
    xaiOauthAccount.value = data.xaiOauth?.account ?? null
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

function clearPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function resetDeviceFlow() {
  clearPoll()
  xaiConnecting.value = false
  xaiPendingId.value = ''
  xaiUserCode.value = ''
  xaiVerificationUri.value = ''
  xaiVerificationUriComplete.value = null
  xaiExpiresAt.value = 0
}

async function startXaiSignIn() {
  xaiPollError.value = ''
  error.value = ''
  saved.value = ''
  try {
    const data = await api<{
      pendingId: string
      userCode: string
      verificationUri: string
      verificationUriComplete: string | null
      expiresIn: number
      interval: number
    }>('/settings/ai/xai/start', { method: 'POST', body: {} })
    xaiPendingId.value = data.pendingId
    xaiUserCode.value = data.userCode
    xaiVerificationUri.value = data.verificationUri
    xaiVerificationUriComplete.value = data.verificationUriComplete
    xaiExpiresAt.value = Date.now() + data.expiresIn * 1000
    xaiConnecting.value = true
    schedulePoll(data.interval)
  } catch (err) {
    xaiPollError.value = err instanceof ApiError ? err.message : 'Could not start sign-in with xAI.'
  }
}

function schedulePoll(interval: number) {
  clearPoll()
  pollTimer = setTimeout(() => void pollXaiSignIn(), Math.max(1, interval) * 1000)
}

async function pollXaiSignIn() {
  if (!xaiPendingId.value) return
  try {
    const data = await api<{
      status: 'pending' | 'connected' | 'expired' | 'denied' | 'error'
      interval?: number
      account?: string | null
      message?: string
    }>('/settings/ai/xai/poll', { method: 'POST', body: { pendingId: xaiPendingId.value } })
    if (data.status === 'pending') {
      schedulePoll(data.interval ?? 5)
      return
    }
    if (data.status === 'connected') {
      resetDeviceFlow()
      xaiOauthConnected.value = true
      xaiOauthAccount.value = data.account ?? null
      if (provider.value !== 'xai') provider.value = 'xai'
      saved.value = data.account ? `Signed in with xAI as ${data.account}.` : 'Signed in with xAI.'
      return
    }
    resetDeviceFlow()
    xaiPollError.value = data.message || 'Sign-in with xAI did not finish.'
  } catch (err) {
    resetDeviceFlow()
    xaiPollError.value = err instanceof ApiError ? err.message : 'Could not finish sign-in with xAI.'
  }
}

async function cancelXaiSignIn() {
  const pendingId = xaiPendingId.value
  resetDeviceFlow()
  xaiPollError.value = ''
  if (!pendingId) return
  try {
    await api('/settings/ai/xai/cancel', { method: 'POST', body: { pendingId } })
  } catch {
    // Already cancelled locally.
  }
}

async function disconnectXai() {
  if (!confirm('Disconnect xAI? The assistant will need an API key, or a new sign-in, before it can run.')) return
  xaiDisconnecting.value = true
  xaiPollError.value = ''
  error.value = ''
  try {
    await api('/settings/ai/xai/disconnect', { method: 'POST', body: {} })
    xaiOauthConnected.value = false
    xaiOauthAccount.value = null
    saved.value = 'Disconnected from xAI.'
  } catch (err) {
    xaiPollError.value = err instanceof ApiError ? err.message : 'Could not disconnect xAI.'
  } finally {
    xaiDisconnecting.value = false
  }
}

onBeforeUnmount(() => {
  clearPoll()
})
</script>

<template>
  <div class="p-6">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">AI</h1>
      </template>
    </SettingsNav>

    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">
      The assistant uses the model you choose and either an API key or, when this install allows it, a sign-in with xAI.
      Draft content is sent to that provider when someone uses the assistant. Check the provider's data policy before you switch it on.
      Keys and sign-in tokens are stored encrypted and are never shown again.
    </p>

    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>

    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <FwbAlert v-if="testResult" type="success" class="mb-4">{{ testResult }}</FwbAlert>
      <FwbAlert v-if="testError" type="danger" class="mb-4">{{ testError }}</FwbAlert>

      <div class="mb-6">
        <FwbToggle v-model="enabled" label="Switch the assistant on" />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">When this is off, people can still edit pages by hand.</p>
      </div>

      <div class="mb-4">
        <FwbSelect :model-value="provider" label="Provider" :options="[...PROVIDERS]" @update:model-value="onProviderChange(String($event))" />
      </div>

      <div class="mb-4">
        <FwbInput v-model="baseUrl" label="Base URL" :placeholder="provider === 'custom' ? 'https://example.com/v1' : 'Leave blank to use the provider default'" />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Needed for a custom or local server. For the named providers, leave this blank unless you have a reason to change it.</p>
      </div>

      <div class="mb-4">
        <FwbInput v-model="model" label="Model" placeholder="grok-4" required />
      </div>
      <div class="mb-4">
        <FwbInput v-model="smallModel" label="Cheaper model (optional)" placeholder="For small jobs such as alt text" />
      </div>

      <div v-if="xaiOauthEnabled" class="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 class="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in with xAI</h2>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Use your SuperGrok or X Premium+ subscription instead of pasting an API key. Cost caps still apply.
          xAI sometimes refuses sign-in access on some subscription tiers. If that happens, paste an API key below.
        </p>
        <FwbAlert v-if="xaiPollError" type="danger" class="mb-3">{{ xaiPollError }}</FwbAlert>
        <div v-if="xaiOauthConnected && !xaiConnecting" class="space-y-3">
          <p class="text-sm text-gray-800 dark:text-gray-200">
            {{ xaiOauthAccount ? `Signed in with xAI as ${xaiOauthAccount}.` : 'Signed in with xAI.' }}
          </p>
          <FwbButton color="light" type="button" :disabled="xaiDisconnecting || saving || testing" @click="disconnectXai">
            {{ xaiDisconnecting ? 'Disconnecting…' : 'Disconnect' }}
          </FwbButton>
        </div>
        <div v-else-if="xaiConnecting" class="space-y-3">
          <p class="text-sm text-gray-700 dark:text-gray-300">Open the link, sign in, and enter this code if asked.</p>
          <p class="font-mono text-2xl tracking-widest text-gray-900 dark:text-gray-100" data-testid="xai-user-code">{{ xaiUserCode }}</p>
          <p class="text-sm">
            <a
              class="text-blue-700 no-underline hover:underline dark:text-blue-400"
              :href="xaiVerificationUriComplete || xaiVerificationUri"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="xai-verification-link"
            >{{ xaiVerificationUri }}</a>
          </p>
          <FwbButton color="light" type="button" @click="cancelXaiSignIn">Cancel</FwbButton>
        </div>
        <FwbButton v-else color="light" type="button" :disabled="saving || testing" @click="startXaiSignIn">Sign in with xAI</FwbButton>
      </div>

      <div class="mb-6">
        <FwbInput
          v-model="keyValue"
          type="password"
          label="API key"
          :placeholder="keySet ? 'A key is already saved. Enter a new one to replace it.' : 'Paste your API key'"
          autocomplete="off"
        />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          <template v-if="xaiOauthConnected">An API key is optional while you are signed in with xAI. It is used if sign-in stops working.</template>
          <template v-else-if="keySet">A key is already saved. It cannot be read back.</template>
          <template v-else>The key is write-only: after you save it, it cannot be read back.</template>
        </p>
      </div>

      <h2 class="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Cost caps</h2>
      <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
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
