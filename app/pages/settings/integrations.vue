<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { emptyToNull, type SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const loading = ref(true)
const saving = ref(false)
const connecting = ref(false)
const testing = ref(false)
const error = ref('')
const saved = ref('')
const testResult = ref('')
const mail = ref<SettingsPayload['mail'] | null>(null)
const secretsSet = ref<Record<string, boolean>>({})
const googleClientId = ref('')
const googleSecret = ref('')
const from = ref('')
const cloudflareToken = ref('')
const testTo = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    mail.value = data.mail
    secretsSet.value = data.secretsSet
    googleClientId.value = data.settings.mail.googleClientId ?? ''
    from.value = data.settings.mail.from ?? ''
    googleSecret.value = ''
    cloudflareToken.value = ''
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load settings.'
  } finally {
    loading.value = false
  }
}

async function saveCloudflare() {
  saving.value = true
  error.value = ''
  saved.value = ''
  try {
    if (cloudflareToken.value.trim()) {
      await api('/settings/secrets/cloudflare_token', { method: 'PUT', body: { value: cloudflareToken.value.trim() } })
      cloudflareToken.value = ''
    }
    saved.value = 'Cloudflare token saved. The zone is set when the site is installed, not on this screen.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save the Cloudflare token.'
  } finally {
    saving.value = false
  }
}

async function saveMail() {
  saving.value = true
  error.value = ''
  saved.value = ''
  try {
    await api('/settings', { method: 'PATCH', body: { mail: { googleClientId: emptyToNull(googleClientId.value), from: emptyToNull(from.value) } } })
    if (googleSecret.value.trim()) {
      await api('/settings/secrets/google_oauth_client_secret', { method: 'PUT', body: { value: googleSecret.value.trim() } })
      googleSecret.value = ''
    }
    saved.value = 'Email settings saved.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save email settings.'
  } finally {
    saving.value = false
  }
}

async function connect() {
  connecting.value = true
  error.value = ''
  try {
    const data = await api<{ url: string }>('/settings/mail/google/start', { method: 'POST', body: {} })
    window.location.href = data.url
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not start Google sign-in.'
    connecting.value = false
  }
}

async function disconnect() {
  if (!confirm('Disconnect Google Workspace mail? Invites and notices will stop going out until you connect again.')) return
  error.value = ''
  try {
    await api('/settings/mail/google/disconnect', { method: 'POST', body: {} })
    saved.value = 'Google Workspace is disconnected.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not disconnect Google Workspace.'
  }
}

async function sendTest() {
  testing.value = true
  testResult.value = ''
  error.value = ''
  try {
    const body = testTo.value.trim() ? { to: testTo.value.trim() } : {}
    await api('/settings/mail/test', { method: 'POST', body })
    testResult.value = testTo.value.trim() ? `A test email was sent to ${testTo.value.trim()}.` : 'A test email was sent to you.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not send a test email.'
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Integrations</h1>
      </template>
    </SettingsNav>
    <SettingsDemoNotice />
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Tokens and secrets are stored encrypted and are never shown again after you save them. The assistant key is under <NuxtLink to="/settings/ai">AI</NuxtLink>.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>
    <div v-else class="max-w-xl space-y-10">
      <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success">{{ saved }}</FwbAlert>
      <FwbAlert v-if="testResult" type="success">{{ testResult }}</FwbAlert>

      <section>
        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Cloudflare</h2>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">Used to purge the cache after a publish. The zone id is set when the site is installed.</p>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300">{{ secretsSet.cloudflare_token ? 'A token is already saved. Enter a new one only if you need to replace it.' : 'No token is saved yet.' }}</p>
        <div class="mb-4">
          <FwbInput v-model="cloudflareToken" type="password" label="API token" autocomplete="off" :placeholder="secretsSet.cloudflare_token ? 'Leave blank to keep the saved token' : ''" />
        </div>
        <FwbButton :disabled="saving || !cloudflareToken.trim()" @click="saveCloudflare">{{ saving ? 'Saving…' : 'Save token' }}</FwbButton>
      </section>

      <section>
        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Google Workspace email</h2>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">Used for invites and notifications. Add the OAuth client, save, then connect the mailbox.</p>
        <p v-if="mail" class="mb-3 text-sm text-gray-700 dark:text-gray-300">
          <template v-if="mail.googleConnected">Connected as {{ mail.googleAccount ?? 'a Google account' }}.</template>
          <template v-else-if="mail.transport === 'outbox'">This site is writing mail to a local outbox (typical in development). You can still connect Google for a real mailbox.</template>
          <template v-else>Google Workspace is not connected.</template>
        </p>
        <div class="mb-4">
          <FwbInput v-model="googleClientId" label="OAuth client id" autocomplete="off" />
        </div>
        <div class="mb-4">
          <FwbInput v-model="googleSecret" type="password" label="OAuth client secret" autocomplete="off" :placeholder="secretsSet.google_oauth_client_secret ? 'Leave blank to keep the saved secret' : ''" />
          <p v-if="secretsSet.google_oauth_client_secret" class="mt-1 text-sm text-gray-500 dark:text-gray-400">A client secret is already saved.</p>
        </div>
        <div class="mb-4">
          <FwbInput v-model="from" label="From address" placeholder="hello@example.org" />
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Optional. If blank, mail comes from the connected Google account.</p>
        </div>
        <div class="mb-6 flex flex-wrap gap-2">
          <FwbButton :disabled="saving" @click="saveMail">{{ saving ? 'Saving…' : 'Save email settings' }}</FwbButton>
          <FwbButton v-if="!mail?.googleConnected" color="light" :disabled="connecting" @click="connect">{{ connecting ? 'Opening Google…' : 'Connect Google Workspace' }}</FwbButton>
          <FwbButton v-else color="light" @click="disconnect">Disconnect</FwbButton>
        </div>
        <div class="mb-3">
          <FwbInput v-model="testTo" label="Send a test email to (optional)" placeholder="you@example.org" />
        </div>
        <FwbButton color="light" :disabled="testing" @click="sendTest">{{ testing ? 'Sending…' : 'Send test email' }}</FwbButton>
      </section>
    </div>
  </div>
</template>
