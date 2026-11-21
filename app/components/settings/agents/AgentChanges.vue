<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import { CHANGE_STATUS_LABELS, when, type AgentChangeItem } from '../../../utils/agents'
import UndoDialog from './UndoDialog.vue'

const emit = defineEmits<{ message: [text: string]; error: [text: string] }>()
const loading = ref(true)
const changes = ref<AgentChangeItem[]>([])
const undoing = ref<AgentChangeItem | null>(null)

async function load() {
  loading.value = true
  try {
    changes.value = (await api<{ changes: AgentChangeItem[] }>('/agent/changes?limit=50')).changes
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not load changes.')
  } finally {
    loading.value = false
  }
}
function undone(message: string) {
  undoing.value = null
  emit('message', message)
  void load()
}
const badge = (c: AgentChangeItem) => (c.status === 'published' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100' : c.status === 'review' || c.status === 'publishing' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100' : c.status === 'failed' ? 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100' : 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200')
const canUndo = (c: AgentChangeItem) => c.status === 'published' && !c.undoOf

onMounted(load)
</script>

<template>
  <div>
    <p class="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Everything agents have changed or drafted. Open one to see it rendered with the differences marked. A change that is live can be undone with one button.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading changes…</p>
    <p v-else-if="!changes.length" class="text-sm text-gray-600 dark:text-gray-400">No agent has made a change yet.</p>
    <ul v-else class="m-0 list-none space-y-3 p-0">
      <li v-for="c in changes" :key="c.id" class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" :data-testid="`change-${c.id}`">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="m-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{{ c.title }}</h3>
            <p class="m-0 mt-1 text-xs text-gray-500 dark:text-gray-400">by <strong>{{ c.tokenName }}</strong> · {{ when(c.createdAt) }} · <code>{{ c.id }}</code><template v-if="c.undoOf"> · an undo of {{ c.undoOf }}</template></p>
          </div>
          <span class="rounded px-2 py-0.5 text-xs font-medium" :class="badge(c)">{{ CHANGE_STATUS_LABELS[c.status] }}</span>
        </div>
        <p class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300"><span class="text-gray-500 dark:text-gray-400">The agent's own words for why:</span> “{{ c.reason }}”</p>
        <p v-if="c.targets.length" class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">Touches: {{ c.targets.map((t) => (t.path ? `${t.label} (${t.path})` : t.label)).join(', ') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <NuxtLink :to="`/settings/agents/changes/${c.id}`" class="inline-block rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm no-underline text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700">{{ c.status === 'open' || c.status === 'review' ? 'Preview' : 'See what changed' }}</NuxtLink>
          <FwbButton v-if="canUndo(c)" size="sm" color="red" @click="undoing = c">Undo</FwbButton>
        </div>
      </li>
    </ul>
    <UndoDialog v-if="undoing" :change-id="undoing.id" :title="undoing.title" @close="undoing = null" @done="undone" />
  </div>
</template>
