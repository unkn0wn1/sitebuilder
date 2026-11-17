<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface SystemStatus {
  version: string
  node: string
  uptimeSeconds: number
  memoryRssBytes: number
  disk: { freeBytes: number; totalBytes: number } | null
  databaseBytes: number | null
  lastRelease: { id: string; kind: string; state: string; createdAt: string } | null
  lastBackup: { finishedAt: string | null; state: string } | null
  jobs: { counts: { lane: string; state: string; n: number }[]; oldestQueuedAt: string | null; recentFailures: { id: string; kind: string; lastError: string | null; finishedAt: string | null }[] }
}

const loading = ref(true)
const error = ref('')
const status = ref<SystemStatus | null>(null)

function bytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function uptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    status.value = await api<SystemStatus>('/system')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load system status.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900">System</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600">This screen is for operators. It shows whether the server and job queue are healthy.</p>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="loading" class="text-gray-500">Loading…</p>
    <dl v-else-if="status" class="grid max-w-2xl grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div><dt class="text-gray-500">Version</dt><dd class="m-0 font-medium text-gray-900">{{ status.version }}</dd></div>
      <div><dt class="text-gray-500">Node</dt><dd class="m-0 font-medium text-gray-900">{{ status.node }}</dd></div>
      <div><dt class="text-gray-500">Up for</dt><dd class="m-0 font-medium text-gray-900">{{ uptime(status.uptimeSeconds) }}</dd></div>
      <div><dt class="text-gray-500">Memory</dt><dd class="m-0 font-medium text-gray-900">{{ bytes(status.memoryRssBytes) }}</dd></div>
      <div><dt class="text-gray-500">Database</dt><dd class="m-0 font-medium text-gray-900">{{ bytes(status.databaseBytes) }}</dd></div>
      <div>
        <dt class="text-gray-500">Disk</dt>
        <dd class="m-0 font-medium text-gray-900">{{ status.disk ? `${bytes(status.disk.freeBytes)} free of ${bytes(status.disk.totalBytes)}` : '—' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">Last release</dt>
        <dd class="m-0 font-medium text-gray-900">{{ status.lastRelease ? `${status.lastRelease.state}, ${timeAgo(status.lastRelease.createdAt)}` : 'None' }}</dd>
      </div>
      <div>
        <dt class="text-gray-500">Last backup</dt>
        <dd class="m-0 font-medium text-gray-900">{{ status.lastBackup?.finishedAt ? `${status.lastBackup.state}, ${timeAgo(status.lastBackup.finishedAt)}` : (status.lastBackup?.state ?? 'None') }}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-gray-500">Job queue</dt>
        <dd class="m-0 font-medium text-gray-900">
          <p v-if="!status.jobs.counts.length" class="m-0">No jobs in the queue.</p>
          <ul v-else class="m-0 list-none p-0">
            <li v-for="row in status.jobs.counts" :key="`${row.lane}-${row.state}`">{{ row.lane }} — {{ row.state }} ({{ row.n }})</li>
          </ul>
          <p v-if="status.jobs.oldestQueuedAt" class="mt-1 mb-0 font-normal text-gray-600">Oldest waiting job: {{ timeAgo(status.jobs.oldestQueuedAt) }}</p>
        </dd>
      </div>
      <div v-if="status.jobs.recentFailures.length" class="sm:col-span-2">
        <dt class="text-gray-500">Recent failures</dt>
        <dd class="m-0">
          <ul class="m-0 list-none p-0">
            <li v-for="job in status.jobs.recentFailures" :key="job.id" class="text-gray-800">
              {{ job.kind }} — {{ job.lastError || 'Failed' }}
            </li>
          </ul>
        </dd>
      </div>
    </dl>
  </div>
</template>
