<script setup lang="ts">
import { api } from '../../../utils/api'
import SettingsNav from '../../../components/settings/SettingsNav.vue'
import AgentActivity from '../../../components/settings/agents/AgentActivity.vue'
import AgentAlerts from '../../../components/settings/agents/AgentAlerts.vue'
import AgentChanges from '../../../components/settings/agents/AgentChanges.vue'
import AgentTokens from '../../../components/settings/agents/AgentTokens.vue'

definePageMeta({ layout: 'builder' })

const TABS = [
  { key: 'tokens', label: 'Tokens' },
  { key: 'changes', label: 'Changes' },
  { key: 'activity', label: 'Activity' },
  { key: 'alerts', label: 'Alerts' },
] as const
type Tab = (typeof TABS)[number]['key']

const route = useRoute()
const router = useRouter()
const tab = computed<Tab>(() => (TABS.some((t) => t.key === route.query.tab) ? (route.query.tab as Tab) : 'tokens'))
const message = ref('')
const error = ref('')
const siteName = ref('')

function say(text: string) {
  error.value = ''
  message.value = text
}
function fail(text: string) {
  message.value = ''
  error.value = text
}
function open(key: Tab) {
  message.value = ''
  error.value = ''
  void router.replace({ query: key === 'tokens' ? {} : { tab: key } })
}

onMounted(async () => {
  try {
    siteName.value = (await api<{ name: string }>('/settings')).name ?? ''
  } catch {
    /* the always-allow dialog will say it cannot confirm */
  }
})
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Agents</h1>
      </template>
    </SettingsNav>
    <p class="mb-4 max-w-2xl text-gray-600 dark:text-gray-400">Let an AI assistant read this site and make changes, within limits you set. Everything it drafts waits for a person unless a rule says it may go live. Donation forms and embeds can never be touched.</p>
    <nav class="mb-6 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700" aria-label="Agents sections">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm"
        :class="tab === t.key ? 'border-gray-900 font-semibold text-gray-900 dark:border-gray-100 dark:text-gray-100' : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'"
        :aria-current="tab === t.key ? 'page' : undefined"
        @click="open(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="message" type="success" class="mb-4">{{ message }}</FwbAlert>
    <AgentTokens v-if="tab === 'tokens'" :site-name="siteName" @message="say" @error="fail" />
    <AgentChanges v-else-if="tab === 'changes'" @message="say" @error="fail" />
    <AgentActivity v-else-if="tab === 'activity'" @error="fail" />
    <AgentAlerts v-else @message="say" @error="fail" />
  </div>
</template>
