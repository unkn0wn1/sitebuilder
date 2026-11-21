<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface BackupJob {
  id: string
  state: string
  createdAt: string
  finishedAt: string | null
  lastError: string | null
}

interface StoredItem {
  key: string
  lastModified: string
  size?: number
}

const loading = ref(true)
const requesting = ref(false)
const error = ref('')
const saved = ref('')
const jobs = ref<BackupJob[]>([])
const store = ref<{ kind: string; location: string; items: StoredItem[] } | null>(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ jobs: BackupJob[]; store: { kind: string; location: string; items: StoredItem[] } | null }>('/backups')
    jobs.value = data.jobs
    store.value = data.store
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load backups.'
  } finally {
    loading.value = false
  }
}

async function requestNow() {
  requesting.value = true
  error.value = ''
  saved.value = ''
  try {
    await api('/backups', { method: 'POST', body: {} })
    saved.value = 'A backup has been queued. It will appear in the list when it finishes.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not start a backup.'
  } finally {
    requesting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Backups</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Nightly backups are stored where the site was set up to keep them. You can also start one now. This is a database backup, not a portable export of pages.</p>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading backups…</p>
    <div v-else class="space-y-8">
      <FwbButton :disabled="requesting" @click="requestNow">{{ requesting ? 'Starting…' : 'Back up now' }}</FwbButton>
      <section>
        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Recent backup jobs</h2>
        <p v-if="!jobs.length" class="text-sm text-gray-500 dark:text-gray-400">No backup jobs yet.</p>
        <ul v-else class="m-0 list-none space-y-2 p-0">
          <li v-for="job in jobs" :key="job.id" class="text-sm text-gray-700 dark:text-gray-300">
            {{ timeAgo(job.createdAt) }} — {{ job.state }}<span v-if="job.lastError"> ({{ job.lastError }})</span>
          </li>
        </ul>
      </section>
      <section>
        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Stored copies</h2>
        <p v-if="!store" class="text-sm text-gray-500 dark:text-gray-400">No backup store is configured on this server yet.</p>
        <template v-else>
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">{{ store.kind }} — {{ store.location }}</p>
          <p v-if="!store.items.length" class="text-sm text-gray-500 dark:text-gray-400">No stored copies yet.</p>
          <ul v-else class="m-0 list-none space-y-2 p-0">
            <li v-for="item in store.items" :key="item.key" class="text-sm text-gray-700 dark:text-gray-300">
              {{ item.key }} — {{ timeAgo(item.lastModified) }}
            </li>
          </ul>
        </template>
      </section>
    </div>
  </div>
</template>
