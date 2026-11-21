<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { can } from '#shared/roles'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface ReleaseItem {
  id: string
  kind: 'publish' | 'rollback' | 'full_render'
  state: 'building' | 'live' | 'failed' | 'superseded'
  createdBy: string
  reviewId: string | null
  reason: string | null
  error: string | null
  createdAt: string
  finishedAt: string | null
}

interface AuditItem {
  id: string
  actorId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  at: string
}

const { user } = useSession()
const canRollback = computed(() => user.value && can(user.value, 'site.rollback'))
const canAudit = computed(() => user.value && can(user.value, 'audit.read'))
const loading = ref(true)
const error = ref('')
const saved = ref('')
const releases = ref<ReleaseItem[]>([])
const audit = ref<AuditItem[]>([])
const rollbackId = ref('')
const rollbackReason = ref('')
const rolling = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await api<{ items: ReleaseItem[] }>('/releases')
    releases.value = list.items
    if (canAudit.value) {
      const events = await api<{ items: AuditItem[] }>('/audit?pageSize=20')
      audit.value = events.items
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load publishing history.'
  } finally {
    loading.value = false
  }
}

async function rollback() {
  if (!rollbackId.value || rollbackReason.value.trim().length < 5) return
  if (!confirm('Roll the whole site back to this release? This is an emergency action and does not need a second approver.')) return
  rolling.value = true
  error.value = ''
  saved.value = ''
  try {
    await api(`/releases/${rollbackId.value}/rollback`, { method: 'POST', body: { reason: rollbackReason.value.trim() } })
    saved.value = 'Rollback started. The site is being restored to that release.'
    rollbackReason.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not roll back.'
  } finally {
    rolling.value = false
  }
}

const kindLabel: Record<ReleaseItem['kind'], string> = {
  publish: 'Publish',
  rollback: 'Rollback',
  full_render: 'Full rebuild',
}

onMounted(load)
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Publishing</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Recent releases of the public site. Rolling back is an emergency step for admins: it restores an earlier release and does not wait for another approver.</p>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading…</p>
    <div v-else class="space-y-10">
      <section>
        <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Releases</h2>
        <p v-if="!releases.length" class="text-sm text-gray-500 dark:text-gray-400">No releases yet.</p>
        <FwbTable v-else hoverable>
          <FwbTableHead>
            <FwbTableHeadCell>When</FwbTableHeadCell>
            <FwbTableHeadCell>Kind</FwbTableHeadCell>
            <FwbTableHeadCell>State</FwbTableHeadCell>
            <FwbTableHeadCell>Notes</FwbTableHeadCell>
            <FwbTableHeadCell v-if="canRollback"><span class="sr-only">Actions</span></FwbTableHeadCell>
          </FwbTableHead>
          <FwbTableBody>
            <FwbTableRow v-for="item in releases" :key="item.id">
              <FwbTableCell>{{ timeAgo(item.createdAt) }}</FwbTableCell>
              <FwbTableCell>{{ kindLabel[item.kind] }}</FwbTableCell>
              <FwbTableCell>{{ item.state === 'live' ? 'Live' : item.state === 'superseded' ? 'Replaced' : item.state === 'building' ? 'Building' : 'Failed' }}</FwbTableCell>
              <FwbTableCell class="text-sm text-gray-600 dark:text-gray-400">{{ item.error || item.reason || (item.reviewId ? 'From an approval' : '') }}</FwbTableCell>
              <FwbTableCell v-if="canRollback">
                <FwbButton v-if="item.state !== 'live'" color="light" size="sm" @click="rollbackId = item.id">Roll back to this</FwbButton>
              </FwbTableCell>
            </FwbTableRow>
          </FwbTableBody>
        </FwbTable>
        <form v-if="canRollback && rollbackId" class="mt-4 max-w-xl space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4" @submit.prevent="rollback">
          <p class="m-0 text-sm text-gray-700 dark:text-gray-300">Explain why you're rolling back (at least a few words). This is recorded in the activity log.</p>
          <FwbInput v-model="rollbackReason" label="Reason" />
          <div class="flex gap-2">
            <FwbButton type="submit" :disabled="rolling || rollbackReason.trim().length < 5">{{ rolling ? 'Rolling back…' : 'Confirm rollback' }}</FwbButton>
            <FwbButton color="light" type="button" @click="rollbackId = ''; rollbackReason = ''">Cancel</FwbButton>
          </div>
        </form>
      </section>
      <section v-if="canAudit">
        <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Recent activity</h2>
        <p v-if="!audit.length" class="text-sm text-gray-500 dark:text-gray-400">No activity yet.</p>
        <ul v-else class="m-0 list-none space-y-2 p-0">
          <li v-for="item in audit" :key="item.id" class="text-sm text-gray-700 dark:text-gray-300">
            <span class="text-gray-500 dark:text-gray-400">{{ timeAgo(item.at) }}</span>
            — {{ item.action }}<span v-if="item.targetType"> on {{ item.targetType }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
