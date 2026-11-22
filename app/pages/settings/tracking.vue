<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { emptyToNull, type SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const ga4 = ref('')
const gtm = ref('')
const plausible = ref('')
const cookiebot = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    const t = data.settings.tracking
    ga4.value = t.ga4 ?? ''
    gtm.value = t.gtm ?? ''
    plausible.value = t.plausible ?? ''
    cookiebot.value = t.cookiebot ?? ''
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load settings.'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  saved.value = ''
  try {
    const data = await api<SettingsPayload>('/settings', {
      method: 'PATCH',
      body: { tracking: { ga4: emptyToNull(ga4.value), gtm: emptyToNull(gtm.value), plausible: emptyToNull(plausible.value), cookiebot: emptyToNull(cookiebot.value) } },
    })
    saved.value = data.rebuilding ? 'Saved. Updating the live site now.' : 'Saved.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save settings.'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Tracking</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">These IDs are added to the public site when set. Tag Manager can load any script, so only add it if you trust what is in that container. Leave a field blank to turn that tool off.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>
    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <div class="mb-4">
        <FwbInput v-model="ga4" label="Google Analytics 4" placeholder="G-ABC123XYZ" />
      </div>
      <div class="mb-4">
        <FwbInput v-model="gtm" label="Google Tag Manager" placeholder="GTM-ABC1234" />
      </div>
      <div class="mb-4">
        <FwbInput v-model="plausible" label="Plausible domain" placeholder="example.org" />
      </div>
      <div class="mb-6">
        <FwbInput v-model="cookiebot" label="Cookiebot domain group id" />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">A 36-character id from Cookiebot, if you use it for consent.</p>
      </div>
      <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
    </form>
  </div>
</template>
