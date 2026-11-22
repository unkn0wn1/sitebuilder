<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import { AUDIT_LABELS, when, type AgentAuditItem } from '../../../utils/agents'

const emit = defineEmits<{ error: [text: string] }>()
const loading = ref(true)
const items = ref<AgentAuditItem[]>([])
const total = ref(0)
const page = ref(1)
const PAGE_SIZE = 25

async function load() {
  loading.value = true
  try {
    const data = await api<{ items: AgentAuditItem[]; total: number }>(`/agent/audit?page=${page.value}&pageSize=${PAGE_SIZE}`)
    items.value = data.items
    total.value = data.total
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not load the activity log.')
  } finally {
    loading.value = false
  }
}
function go(n: number) {
  page.value = n
  void load()
}
function detail(e: AgentAuditItem): string {
  const d = e.details ?? {}
  const bits: string[] = []
  if (typeof d.tool === 'string') bits.push(`tool ${d.tool}`)
  if (typeof d.code === 'string') bits.push(String(d.code))
  if (typeof d.message === 'string') bits.push(d.message)
  if (typeof d.title === 'string') bits.push(d.title)
  if (d.permanent === true) bits.push('permanent, no end date')
  if (typeof d.until === 'string') bits.push(`until ${when(d.until)}`)
  if (d.wasPermanent === true) bits.push('it had been permanent')
  if (typeof d.name === 'string' && !bits.length) bits.push(d.name)
  return bits.join(' · ')
}
const flag = (e: AgentAuditItem) => e.action === 'agent.call.blocked' || e.action === 'agent.token.auto_paused'
const permanent = (e: AgentAuditItem) => e.action === 'agent.token.always_allow_on' && e.details?.permanent === true

onMounted(load)
</script>

<template>
  <div>
    <p class="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Every token change, draft, publish, undo and blocked attempt, newest first. Words from agents and from the site are shown as plain text.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading activity…</p>
    <p v-else-if="!items.length" class="text-sm text-gray-600 dark:text-gray-400">Nothing yet.</p>
    <ul v-else class="m-0 list-none divide-y divide-gray-200 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0" data-testid="agent-activity">
      <li v-for="e in items" :key="e.id" class="px-4 py-3 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium" :class="flag(e) ? 'text-red-700 dark:text-red-300' : permanent(e) ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'">{{ AUDIT_LABELS[e.action] ?? e.action }}</span>
          <span v-if="e.tokenName" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">{{ e.tokenName }}</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ when(e.at) }}</span>
        </div>
        <p v-if="detail(e)" class="m-0 mt-1 break-words text-gray-600 dark:text-gray-400">{{ detail(e) }}</p>
      </li>
    </ul>
    <div v-if="total > PAGE_SIZE" class="mt-3 flex items-center gap-2 text-sm">
      <FwbButton size="sm" color="light" :disabled="page <= 1" @click="go(page - 1)">Newer</FwbButton>
      <span class="text-gray-600 dark:text-gray-400">Page {{ page }} of {{ Math.ceil(total / PAGE_SIZE) }}</span>
      <FwbButton size="sm" color="light" :disabled="page * PAGE_SIZE >= total" @click="go(page + 1)">Older</FwbButton>
    </div>
  </div>
</template>
