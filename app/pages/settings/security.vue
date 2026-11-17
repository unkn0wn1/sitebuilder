<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { EMBED_PROVIDER_KEYS } from '#shared/settings'
import type { SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const LABELS: Record<(typeof EMBED_PROVIDER_KEYS)[number], string> = {
  virtuous: 'Virtuous donation forms',
  youtube: 'YouTube',
  tally: 'Tally forms',
  google_forms: 'Google Forms',
}

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const allowed = ref<Record<string, boolean>>({})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    const current = data.settings.allowedEmbedProviders
    const next: Record<string, boolean> = {}
    for (const key of EMBED_PROVIDER_KEYS) next[key] = !current || current.includes(key)
    allowed.value = next
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
    const list = EMBED_PROVIDER_KEYS.filter((key) => allowed.value[key])
    await api('/settings', { method: 'PATCH', body: { allowedEmbedProviders: list } })
    saved.value = 'Saved.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save settings.'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900">Security</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600">Choose which third-party embeds editors may add to a page. Unchecked providers can't be added, even if a form or video id is known.</p>
    <p v-if="loading" class="text-gray-500">Loading settings…</p>
    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <div class="mb-6 space-y-3">
        <label v-for="key in EMBED_PROVIDER_KEYS" :key="key" class="flex items-center gap-2 text-sm text-gray-800">
          <input v-model="allowed[key]" type="checkbox" class="rounded border-gray-300" />
          {{ LABELS[key] }}
        </label>
      </div>
      <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
    </form>
  </div>
</template>
