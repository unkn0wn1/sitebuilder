<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import { describeRule, when, type ActionInfo, type AgentTokenItem, type RulePreset } from '../../../utils/agents'
import AlwaysAllowDialog from './AlwaysAllowDialog.vue'
import TokenForm from './TokenForm.vue'

const props = defineProps<{ siteName: string }>()
const emit = defineEmits<{ message: [text: string]; error: [text: string] }>()

const loading = ref(true)
const tokens = ref<AgentTokenItem[]>([])
const gatewayEnabled = ref(true)
const allPaused = ref(false)
const presets = ref<RulePreset[]>([])
const actions = ref<ActionInfo[]>([])
const mode = ref<'list' | 'new'>('list')
const editingId = ref('')
const aaFor = ref<AgentTokenItem | null>(null)
const newSecret = ref('')
const pausing = ref(false)

const labels = computed(() => Object.fromEntries(actions.value.map((a) => [a.key, a.label])))
const origin = computed(() => (import.meta.client ? window.location.origin : ''))
const ordered = computed(() => [...tokens.value].sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked')))
const permanentCount = computed(() => tokens.value.filter((t) => t.status !== 'revoked' && t.alwaysAllow?.permanent).length)

async function load() {
  loading.value = true
  try {
    const [list, pre] = await Promise.all([
      api<{ tokens: AgentTokenItem[]; gatewayEnabled: boolean; allPaused: boolean }>('/agent/tokens'),
      api<{ presets: RulePreset[]; actions: ActionInfo[] }>('/agent/presets'),
    ])
    tokens.value = list.tokens
    gatewayEnabled.value = list.gatewayEnabled
    allPaused.value = list.allPaused
    presets.value = pre.presets
    actions.value = pre.actions
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : 'Could not load tokens.')
  } finally {
    loading.value = false
  }
}

async function run(job: () => Promise<unknown>, ok: string, fail: string) {
  try {
    await job()
    emit('message', ok)
    await load()
  } catch (err) {
    emit('error', err instanceof ApiError ? err.message : fail)
  }
}

async function setAllPaused(paused: boolean) {
  if (paused && !confirm('Stop every agent token now? They all answer "paused" until you resume.')) return
  pausing.value = true
  await run(() => api('/agent/pause', { method: 'POST', body: { paused } }), paused ? 'All agents are paused.' : 'Agents are running again.', 'Could not change that.')
  pausing.value = false
}
const setStatus = (t: AgentTokenItem, status: 'active' | 'paused') => run(() => api(`/agent/tokens/${t.id}`, { method: 'PATCH', body: { status } }), status === 'paused' ? `Paused "${t.name}".` : `"${t.name}" is active again.`, 'Could not change that token.')
function revoke(t: AgentTokenItem) {
  if (!confirm(`Revoke "${t.name}"? It stops working for good. This cannot be undone.`)) return
  return run(() => api(`/agent/tokens/${t.id}`, { method: 'DELETE' }), `Revoked "${t.name}".`, 'Could not revoke it.')
}
const alwaysOff = (t: AgentTokenItem) => run(() => api(`/agent/tokens/${t.id}/always-allow`, { method: 'DELETE' }), `Always-allow is off for "${t.name}".`, 'Could not switch it off.')

function formSaved(message: string, secret?: string) {
  mode.value = 'list'
  editingId.value = ''
  if (secret) newSecret.value = secret
  emit('message', message)
  void load()
}
function dialogDone(message: string) {
  aaFor.value = null
  emit('message', message)
  void load()
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    emit('message', 'Copied.')
  } catch {
    emit('error', 'Copy did not work. Select the text and copy it by hand.')
  }
}

const statusClass = (t: AgentTokenItem) => (t.status === 'active' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100' : t.status === 'paused' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100' : 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200')
const statusLabel = (t: AgentTokenItem) => (t.status === 'paused' ? 'Paused' : t.status === 'revoked' ? 'Revoked' : 'Active')

onMounted(load)
defineExpose({ reload: load })
</script>

<template>
  <div>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading tokens…</p>
    <template v-else>
      <FwbAlert v-if="!gatewayEnabled" type="warning" class="mb-4">
        The agent gateway is switched off on this server, so no token works yet. Set <code>SITEBUILDER_AGENT_GATEWAY=1</code> and restart. You can still make and edit tokens here.
      </FwbAlert>

      <section class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" :class="allPaused ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'" aria-label="Kill switch">
        <div class="min-w-0 flex-1">
          <h2 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ allPaused ? 'All agents are paused' : 'Agents are running' }}</h2>
          <p class="m-0 mt-1 text-sm text-gray-600 dark:text-gray-400">{{ allPaused ? 'Every token answers "paused" until you resume. Nothing an agent does reaches the site.' : 'The kill switch stops every token at once. Use it if something looks wrong.' }}</p>
        </div>
        <FwbButton :color="allPaused ? 'default' : 'red'" :disabled="pausing" @click="setAllPaused(!allPaused)">{{ allPaused ? 'Resume all agents' : 'Pause all agents' }}</FwbButton>
      </section>

      <FwbAlert v-if="permanentCount" type="warning" class="mb-4">{{ permanentCount }} token{{ permanentCount === 1 ? ' has' : 's have' }} always-allow with <strong>no end date</strong>. {{ permanentCount === 1 ? 'It' : 'They' }} can publish changes no rule covers until you switch it off.</FwbAlert>

      <section v-if="newSecret" class="mb-6 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 p-4" aria-label="New token secret">
        <h2 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">Copy the secret now</h2>
        <p class="mt-1 mb-2 text-sm text-gray-700 dark:text-gray-300">It is shown once and cannot be shown again. Only a fingerprint is stored.</p>
        <code class="block break-all rounded bg-white dark:bg-gray-900 p-2 text-sm text-gray-900 dark:text-gray-100" data-testid="new-secret">{{ newSecret }}</code>
        <p class="mt-2 mb-2 text-sm text-gray-700 dark:text-gray-300">For Claude Code: <code class="break-all">claude mcp add --transport http sitebuilder {{ origin }}/agent/mcp --header "Authorization: Bearer {{ newSecret }}"</code></p>
        <div class="flex gap-2"><FwbButton size="sm" @click="copy(newSecret)">Copy secret</FwbButton><FwbButton size="sm" color="light" @click="newSecret = ''">I have copied it</FwbButton></div>
      </section>

      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Tokens</h2>
        <FwbButton v-if="mode === 'list'" @click="mode = 'new'; editingId = ''">Make a token</FwbButton>
      </div>
      <TokenForm v-if="mode === 'new'" class="mb-6" :presets="presets" :actions="actions" @saved="formSaved" @cancel="mode = 'list'" />

      <p v-if="!tokens.length && mode === 'list'" class="text-sm text-gray-600 dark:text-gray-400">No tokens yet. Make one to let an AI assistant read this site and make drafts.</p>
      <ul class="m-0 list-none space-y-3 p-0">
        <li v-for="t in ordered" :key="t.id" class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" :data-testid="`token-${t.id}`">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="m-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">{{ t.name }}</h3>
              <p class="m-0 mt-1 text-xs text-gray-500 dark:text-gray-400"><code>{{ t.prefix }}…</code> · {{ t.access === 'draft' ? 'can make drafts' : 'read only' }} · last used {{ when(t.lastUsedAt) }}<template v-if="t.expiresAt"> · expires {{ when(t.expiresAt) }}</template><template v-if="t.ipAllow?.length"> · only from {{ t.ipAllow.join(', ') }}</template></p>
            </div>
            <div class="flex flex-wrap gap-2">
              <span class="rounded px-2 py-0.5 text-xs font-medium" :class="statusClass(t)">{{ statusLabel(t) }}</span>
              <span v-if="t.alwaysAllow?.permanent && t.status !== 'revoked'" class="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900 dark:bg-red-900 dark:text-red-100" data-testid="permanent-badge">Always-allow: PERMANENT</span>
              <span v-else-if="t.alwaysAllow && t.status !== 'revoked'" class="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">Always-allow until {{ when(t.alwaysAllow.until) }}</span>
            </div>
          </div>
          <p v-if="t.pausedReason && t.status === 'paused'" class="mt-2 mb-0 text-sm text-amber-800 dark:text-amber-200">{{ t.pausedReason }}</p>
          <ul v-if="t.access === 'draft'" class="mt-3 mb-0 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
            <li v-for="r in t.rules" :key="r.id"><strong>{{ r.label }}.</strong> {{ describeRule(r, labels) }}</li>
            <li v-if="!t.rules.length">No rules: every change waits for a person to approve it.</li>
          </ul>
          <div v-if="t.status !== 'revoked'" class="mt-3 flex flex-wrap gap-2">
            <FwbButton size="sm" color="light" @click="editingId = editingId === t.id ? '' : t.id; mode = 'list'">{{ editingId === t.id ? 'Close editor' : 'Edit rules and settings' }}</FwbButton>
            <FwbButton v-if="t.status === 'active'" size="sm" color="light" @click="setStatus(t, 'paused')">Pause</FwbButton>
            <FwbButton v-else size="sm" color="light" @click="setStatus(t, 'active')">Resume</FwbButton>
            <FwbButton v-if="t.access === 'draft' && !t.alwaysAllow" size="sm" color="light" @click="aaFor = t">Always-allow…</FwbButton>
            <FwbButton v-if="t.alwaysAllow" size="sm" color="light" @click="aaFor = t">Change always-allow…</FwbButton>
            <FwbButton v-if="t.alwaysAllow" size="sm" color="yellow" @click="alwaysOff(t)">Switch always-allow off</FwbButton>
            <FwbButton size="sm" color="red" outline @click="revoke(t)">Revoke</FwbButton>
          </div>
          <TokenForm v-if="editingId === t.id" class="mt-4" :token="t" :presets="presets" :actions="actions" @saved="formSaved" @cancel="editingId = ''" />
        </li>
      </ul>
    </template>
    <AlwaysAllowDialog v-if="aaFor" :token="aaFor" :site-name="props.siteName" @close="aaFor = null" @done="dialogDone" />
  </div>
</template>
