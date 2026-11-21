<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const selfApproval = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    selfApproval.value = data.settings.workflow.selfApproval
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
    await api('/settings', { method: 'PATCH', body: { workflow: { selfApproval: selfApproval.value } } })
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
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Workflow</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Publishing still needs approval. This only controls whether the person who submitted a change can also approve it.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>
    <form v-else class="max-w-xl" @submit.prevent="save">
      <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
      <div class="mb-6">
        <FwbToggle v-model="selfApproval" label="Allow people to approve their own changes" />
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">Leave this off for a second pair of eyes. Turn it on for a small team where the same person often writes and publishes.</p>
      </div>
      <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
    </form>
  </div>
</template>
