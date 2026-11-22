<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import { draftFromRule, ruleFromDraft, type ActionInfo, type AgentTokenItem, type RuleDraft, type RulePreset } from '../../../utils/agents'
import AgentRuleEditor from './AgentRuleEditor.vue'

const props = defineProps<{ token?: AgentTokenItem; presets: RulePreset[]; actions: ActionInfo[] }>()
const emit = defineEmits<{ saved: [message: string, secret?: string]; cancel: [] }>()

const editing = computed(() => !!props.token)
const name = ref(props.token?.name ?? '')
const access = ref<'read' | 'draft'>(props.token?.access ?? 'draft')
const presetKey = ref(editing.value ? '' : 'drafts')
const rules = ref<RuleDraft[]>((props.token?.rules ?? []).map((r) => draftFromRule(r)))
const days = ref('')
const keepExpiry = ref(true)
const ips = ref((props.token?.ipAllow ?? []).join(', '))
const busy = ref(false)
const error = ref('')

const preset = computed(() => props.presets.find((p) => p.key === presetKey.value))

function applyPreset() {
  const p = preset.value
  if (!p) return
  access.value = p.access
  rules.value = p.rules.map((r) => draftFromRule(r))
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const ruleList = access.value === 'read' ? [] : rules.value.map(ruleFromDraft)
    const ipAllow = ips.value.split(/[,\s]+/).filter(Boolean)
    const base = { name: name.value.trim(), access: access.value, rules: ruleList, ipAllow: ipAllow.length ? ipAllow : null }
    if (props.token) {
      const body: Record<string, unknown> = { ...base }
      if (!keepExpiry.value) body.expiresAt = days.value ? new Date(Date.now() + Number(days.value) * 86_400_000).toISOString() : null
      await api(`/agent/tokens/${props.token.id}`, { method: 'PATCH', body })
      emit('saved', `Saved "${base.name}".`)
    } else {
      const body = { ...base, ...(days.value ? { expiresAt: new Date(Date.now() + Number(days.value) * 86_400_000).toISOString() } : {}) }
      const made = await api<{ secret: string }>('/agent/tokens', { method: 'POST', body })
      emit('saved', `Made "${base.name}".`, made.secret)
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save that token.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="max-w-3xl space-y-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" :aria-label="editing ? 'Edit token' : 'New token'" @submit.prevent="save">
    <h3 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ editing ? `Edit "${token!.name}"` : 'Make a token' }}</h3>
    <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
    <FwbInput v-model="name" label="Name" placeholder="Claude Code, privacy policy" required />
    <div v-if="!editing" class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <label for="preset" class="mb-2 block text-sm font-medium text-gray-900 dark:text-gray-100">Start from</label>
        <select id="preset" v-model="presetKey" class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 p-2.5 text-sm text-gray-900 dark:text-gray-100" @change="applyPreset">
          <option v-for="p in presets" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
        <p v-if="preset" class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">{{ preset.description }}</p>
      </div>
    </div>
    <fieldset class="min-w-0 border-0 p-0">
      <legend class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">Access</legend>
      <label class="mr-4 inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="access" type="radio" value="draft" /> Read and make drafts</label>
      <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="access" type="radio" value="read" /> Read only</label>
    </fieldset>
    <div v-if="access === 'draft'">
      <h4 class="mb-2 mt-0 text-sm font-medium text-gray-900 dark:text-gray-100">Rules: what may go live without a person</h4>
      <AgentRuleEditor v-model="rules" :actions="actions" />
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label v-if="editing" class="mb-2 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="keepExpiry" type="checkbox" /> Keep the current expiry ({{ token!.expiresAt ? new Date(token!.expiresAt).toLocaleDateString() : 'none' }})</label>
        <FwbInput v-if="!editing || !keepExpiry" v-model="days" type="number" label="Expires after this many days (blank = never)" />
      </div>
      <FwbInput v-model="ips" label="Only from these IP addresses (blank = anywhere)" placeholder="203.0.113.7, 198.51.100.0/24" />
    </div>
    <div class="flex gap-2">
      <FwbButton type="submit" :disabled="busy || !name.trim()">{{ busy ? 'Saving…' : editing ? 'Save changes' : 'Make token' }}</FwbButton>
      <FwbButton color="light" type="button" @click="emit('cancel')">Cancel</FwbButton>
    </div>
  </form>
</template>
