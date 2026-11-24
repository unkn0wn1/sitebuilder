<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { emptyToNull, type SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const { status: demoStatus, load: loadDemo } = useDemoStatus()
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const name = ref('')
const primaryDomain = ref('')
const titlePattern = ref('{page} | {site}')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    name.value = data.name
    primaryDomain.value = data.primaryDomain ?? ''
    titlePattern.value = data.settings.titlePattern
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
      body: {
        name: name.value.trim(),
        ...(demoStatus.value?.demo ? {} : { primaryDomain: emptyToNull(primaryDomain.value)?.toLowerCase() ?? null }),
        titlePattern: titlePattern.value.trim() || '{page} | {site}',
      },
    })
    saved.value = data.rebuilding ? 'Saved. Updating the live site now.' : 'Saved.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save settings.'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadDemo()
  void load()
})
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">General</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">The site name and domain appear in page titles, emails and the public site. A favicon is taken from Brand and Design when a logo is set.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>
    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <div class="mb-4">
        <FwbInput v-model="name" label="Site name" />
      </div>
      <div class="mb-4">
        <FwbInput v-model="primaryDomain" label="Primary domain" placeholder="example.org" :disabled="!!demoStatus?.demo" />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ demoStatus?.demo ? 'The public demo cannot change its hostname.' : "Just the domain, without https://. Leave blank if it isn't set yet." }}</p>
      </div>
      <div class="mb-6">
        <FwbInput v-model="titlePattern" label="Page title pattern" />
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Use {page} for the page title and {site} for the site name. For example, {page} | {site}.</p>
      </div>
      <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
    </form>
  </div>
</template>
