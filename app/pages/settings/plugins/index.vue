<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import SettingsNav from '../../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface Origin {
  directive: string
  origin: string
}

interface SettingField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: string[]
  value: unknown
}

interface PluginRow {
  id: string
  pluginId: string
  name: string
  version: string
  trust: string
  permissions: string[]
  origins: Origin[]
  status: 'enabled' | 'disabled' | 'pending_owner'
  settings: SettingField[]
}

interface ProposalRow {
  id: string
  agentLabel: string
  pluginId: string
  version: string
  trust: string
  reason: string
}

interface CataloguePlugin {
  id: string
  version: string
  contentHash: string
  core: string
  compatible: boolean
  keyId: string
}

interface Issue {
  path: string
  message: string
}

const DIRECTIVES: Record<string, string> = {
  img: 'Images',
  frame: 'Frames',
  connect: 'Connections',
  font: 'Fonts',
  head: 'Head',
}

const { user } = useSession()
const isOperator = computed(() => user.value?.isOperator === true)

const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const notice = ref('')
const formErrors = ref<Issue[]>([])
const cardErrors = ref<Record<string, Issue[]>>({})
const plugins = ref<PluginRow[]>([])
const proposals = ref<ProposalRow[]>([])
const leftovers = ref<{ pluginId: string }[]>([])
const catalogue = ref<CataloguePlugin[]>([])
const catalogueLoading = ref(false)
const catalogueErrors = ref<Issue[]>([])
const installErrors = ref<Issue[]>([])
const drafts = reactive<Record<string, Record<string, string | boolean>>>({})
const confirmPhrase = reactive<Record<string, string>>({})
const archiveFile = ref<File | null>(null)
const signatureFile = ref<File | null>(null)
const formKey = ref(0)

function statusLabel(status: PluginRow['status']): string {
  if (status === 'enabled') return 'On'
  if (status === 'disabled') return 'Off'
  return 'Waiting for an owner'
}

function directiveLabel(directive: string): string {
  return DIRECTIVES[directive] ?? directive
}

function issuesFrom(err: unknown): Issue[] {
  if (!(err instanceof ApiError)) return [{ path: '(error)', message: 'Something went wrong.' }]
  const fields = err.details.fields
  if (!Array.isArray(fields)) return [{ path: '(error)', message: err.message }]
  const parsed = fields.filter((item): item is Issue => {
    if (!item || typeof item !== 'object') return false
    const row = item as { path?: unknown; message?: unknown }
    return typeof row.path === 'string' && typeof row.message === 'string'
  })
  return parsed.length ? parsed : [{ path: '(error)', message: err.message }]
}

function fillDrafts(rows: PluginRow[]) {
  for (const key of Object.keys(drafts)) delete drafts[key]
  for (const plugin of rows) {
    const draft: Record<string, string | boolean> = {}
    for (const field of plugin.settings) {
      if (field.type === 'boolean') draft[field.key] = field.value === true
      else draft[field.key] = field.value == null ? '' : String(field.value)
    }
    drafts[plugin.id] = draft
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api<{ plugins: PluginRow[]; proposals: ProposalRow[]; leftovers: { pluginId: string }[] }>('/plugins')
    plugins.value = data.plugins
    proposals.value = data.proposals
    leftovers.value = data.leftovers
    fillDrafts(data.plugins)
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not load plugins.'
  } finally {
    loading.value = false
  }
}

async function loadCatalogue() {
  catalogueLoading.value = true
  catalogueErrors.value = []
  try {
    const data = await api<{ repo: string; plugins: CataloguePlugin[] }>('/plugins/repository')
    catalogue.value = data.plugins
  } catch (err) {
    catalogue.value = []
    catalogueErrors.value = issuesFrom(err)
  } finally {
    catalogueLoading.value = false
  }
}

async function installFromRepo(item: CataloguePlugin) {
  installErrors.value = []
  notice.value = ''
  busy.value = true
  try {
    const res = await api<{ status: string }>('/plugins/repository/install', { method: 'POST', body: { id: item.id, version: item.version } })
    notice.value = res.status === 'needs_owner' ? 'Installed. An owner has to approve this plugin before it can load those addresses.' : 'Installed and turned on.'
    await load()
  } catch (err) {
    installErrors.value = issuesFrom(err)
  } finally {
    busy.value = false
  }
}

function onFile(which: 'archive' | 'signature', event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const file = target.files?.[0] ?? null
  if (which === 'archive') archiveFile.value = file
  else signatureFile.value = file
}

async function addPlugin() {
  formErrors.value = []
  notice.value = ''
  if (!archiveFile.value) {
    formErrors.value = [{ path: 'archive', message: 'Choose a .tar.gz file.' }]
    return
  }
  busy.value = true
  try {
    const form = new FormData()
    form.append('archive', archiveFile.value)
    if (signatureFile.value) form.append('signature', signatureFile.value)
    const res = await fetch('/api/v1/plugins', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, body: form })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      const err = (data.error ?? {}) as Record<string, unknown>
      throw new ApiError(res.status, typeof err.code === 'string' ? err.code : 'internal', typeof err.message === 'string' ? err.message : 'The plugin was rejected.', err)
    }
    const status = data.status
    notice.value = status === 'needs_owner' ? 'Installed. An owner has to approve this plugin before it can load those addresses.' : 'Installed and turned on.'
    archiveFile.value = null
    signatureFile.value = null
    formKey.value += 1
    await load()
  } catch (err) {
    formErrors.value = issuesFrom(err)
  } finally {
    busy.value = false
  }
}

async function run(id: string, action: 'enable' | 'disable' | 'approve' | 'reject' | 'uninstall') {
  cardErrors.value = { ...cardErrors.value, [id]: [] }
  notice.value = ''
  busy.value = true
  try {
    const method = action === 'uninstall' ? 'DELETE' : 'POST'
    await api(`/plugins/${id}/${action === 'uninstall' ? '' : action}`.replace(/\/$/, ''), { method })
    notice.value = 'Saved.'
    await load()
  } catch (err) {
    cardErrors.value = { ...cardErrors.value, [id]: issuesFrom(err) }
  } finally {
    busy.value = false
  }
}

function textValue(id: string, key: string): string {
  const value = drafts[id]?.[key]
  return typeof value === 'string' ? value : ''
}

function setText(id: string, key: string, value: unknown) {
  const draft = drafts[id]
  if (!draft) return
  draft[key] = typeof value === 'string' ? value : String(value ?? '')
}

function checked(id: string, key: string): boolean {
  return drafts[id]?.[key] === true
}

function onCheck(id: string, key: string, event: Event) {
  const target = event.target
  const draft = drafts[id]
  if (!(target instanceof HTMLInputElement) || !draft) return
  draft[key] = target.checked
}

function setPhrase(id: string, value: unknown) {
  confirmPhrase[id] = typeof value === 'string' ? value : ''
}

async function saveSettings(plugin: PluginRow) {
  cardErrors.value = { ...cardErrors.value, [plugin.id]: [] }
  notice.value = ''
  const body: Record<string, unknown> = {}
  for (const field of plugin.settings) {
    if (field.type === 'boolean') body[field.key] = checked(plugin.id, field.key)
    else if (field.type === 'number') {
      const raw = textValue(plugin.id, field.key).trim()
      if (raw === '') continue
      body[field.key] = Number(raw)
    } else body[field.key] = textValue(plugin.id, field.key)
  }
  busy.value = true
  try {
    await api(`/plugins/${plugin.id}/settings`, { method: 'PUT', body })
    notice.value = 'Settings saved.'
    await load()
  } catch (err) {
    cardErrors.value = { ...cardErrors.value, [plugin.id]: issuesFrom(err) }
  } finally {
    busy.value = false
  }
}

async function removeData(pluginId: string, errorKey: string) {
  cardErrors.value = { ...cardErrors.value, [errorKey]: [] }
  notice.value = ''
  busy.value = true
  try {
    await api(`/plugins/${pluginId}/remove-data`, { method: 'POST', body: { confirm: confirmPhrase[pluginId] ?? '' } })
    confirmPhrase[pluginId] = ''
    notice.value = 'Plugin data removed. The activity log keeps a copy.'
    await load()
  } catch (err) {
    cardErrors.value = { ...cardErrors.value, [errorKey]: issuesFrom(err) }
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  void loadCatalogue()
})
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Plugins</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Install a declarative plugin from a .tar.gz file. Official and Self-installed are the only trust labels. A plugin that asks for an external address stays off until an owner confirms it.</p>
    <FwbAlert v-if="loadError" type="danger" class="mb-4">{{ loadError }}</FwbAlert>
    <FwbAlert v-else-if="notice" type="success" class="mb-4">{{ notice }}</FwbAlert>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading plugins...</p>
    <div v-else class="space-y-8">
      <section class="max-w-xl space-y-4">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Add from the Skewstone repository</h2>
        <p v-if="catalogueLoading" class="m-0 text-sm text-gray-500 dark:text-gray-400">Loading the repository...</p>
        <ul v-if="catalogueErrors.length" class="m-0 list-none space-y-1 p-0">
          <li v-for="issue in catalogueErrors" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
        </ul>
        <ul v-if="installErrors.length" class="m-0 list-none space-y-1 p-0">
          <li v-for="issue in installErrors" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
        </ul>
        <p v-if="!catalogueLoading && !catalogueErrors.length && !catalogue.length" class="m-0 text-sm text-gray-500 dark:text-gray-400">The repository has no plugins.</p>
        <article v-for="item in catalogue" :key="`${item.id}@${item.version}`" class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ item.id }}</h3>
          <p class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">version {{ item.version }}, Official</p>
          <p class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">Core {{ item.core }}</p>
          <p class="mt-2 mb-0 break-all text-sm text-gray-700 dark:text-gray-300">Content hash {{ item.contentHash }}</p>
          <p v-if="!item.compatible" class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">This plugin needs a different Skewstone version.</p>
          <div class="mt-4">
            <FwbButton type="button" :disabled="busy || !item.compatible" @click="installFromRepo(item)">Install</FwbButton>
          </div>
        </article>
      </section>

      <form class="max-w-xl space-y-3" @submit.prevent="addPlugin">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Add a plugin</h2>
        <div :key="formKey" class="space-y-3">
          <label class="block text-sm text-gray-800 dark:text-gray-200">
            Plugin archive (.tar.gz)
            <input class="mt-1 block w-full text-sm" type="file" accept=".tar.gz,.tgz,application/gzip" @change="onFile('archive', $event)" />
          </label>
          <label class="block text-sm text-gray-800 dark:text-gray-200">
            Signature file, optional
            <input class="mt-1 block w-full text-sm" type="file" @change="onFile('signature', $event)" />
          </label>
        </div>
        <ul v-if="formErrors.length" class="m-0 list-none space-y-1 p-0">
          <li v-for="issue in formErrors" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
        </ul>
        <FwbButton type="submit" :disabled="busy">{{ busy ? 'Working...' : 'Install' }}</FwbButton>
      </form>

      <section v-if="proposals.length" class="space-y-4">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Proposals</h2>
        <article v-for="proposal in proposals" :key="proposal.id" class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ proposal.agentLabel }}</h3>
          <p class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">{{ proposal.pluginId }}, version {{ proposal.version }}, {{ proposal.trust }}</p>
          <p class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">{{ proposal.reason }}</p>
          <ul v-if="cardErrors[proposal.id]?.length" class="mt-3 mb-0 list-none space-y-1 p-0">
            <li v-for="issue in cardErrors[proposal.id]" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
          </ul>
          <div class="mt-4 flex flex-wrap gap-2">
            <FwbButton type="button" :disabled="busy" @click="run(proposal.id, 'approve')">Approve</FwbButton>
            <FwbButton color="light" type="button" :disabled="busy" @click="run(proposal.id, 'reject')">Reject</FwbButton>
          </div>
        </article>
      </section>

      <section class="space-y-4">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Installed</h2>
        <p v-if="!plugins.length" class="m-0 text-sm text-gray-500 dark:text-gray-400">No plugins are installed.</p>
        <article v-for="plugin in plugins" :key="plugin.id" class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ plugin.name }}</h3>
          <p class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">{{ plugin.pluginId }}, version {{ plugin.version }}, {{ plugin.trust }}</p>
          <p class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">Permissions: {{ plugin.permissions.join(', ') }}</p>
          <ul v-if="plugin.origins.length" class="mt-2 mb-0 list-none space-y-1 p-0 text-sm text-gray-700 dark:text-gray-300">
            <li v-for="origin in plugin.origins" :key="`${origin.directive}-${origin.origin}`">{{ directiveLabel(origin.directive) }} ({{ origin.directive }}): {{ origin.origin }}</li>
          </ul>
          <p v-else class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">No external origins</p>
          <p class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">Status: {{ statusLabel(plugin.status) }}</p>
          <p v-if="plugin.status === 'pending_owner'" class="mt-2 mb-0 text-sm text-gray-700 dark:text-gray-300">An owner has to approve this plugin before it can load those addresses.</p>
          <ul v-if="cardErrors[plugin.id]?.length" class="mt-3 mb-0 list-none space-y-1 p-0">
            <li v-for="issue in cardErrors[plugin.id]" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
          </ul>
          <div class="mt-4 flex flex-wrap gap-2">
            <FwbButton v-if="plugin.status === 'pending_owner' && isOperator" type="button" :disabled="busy" @click="run(plugin.id, 'approve')">Confirm</FwbButton>
            <FwbButton v-if="plugin.status !== 'disabled'" color="light" type="button" :disabled="busy" @click="run(plugin.id, 'disable')">Disable</FwbButton>
            <FwbButton v-if="plugin.status === 'disabled'" type="button" :disabled="busy" @click="run(plugin.id, 'enable')">Enable</FwbButton>
          </div>

          <form v-if="plugin.settings.length" class="mt-4 space-y-3" @submit.prevent="saveSettings(plugin)">
            <h4 class="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</h4>
            <template v-for="field in plugin.settings" :key="field.key">
              <FwbSelect
                v-if="field.type === 'enum'"
                :model-value="textValue(plugin.id, field.key)"
                :label="field.key"
                :options="(field.options ?? []).map((option) => ({ name: option, value: option }))"
                @update:model-value="setText(plugin.id, field.key, $event)"
              />
              <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <input :checked="checked(plugin.id, field.key)" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" @change="onCheck(plugin.id, field.key, $event)" />
                {{ field.key }}
              </label>
              <FwbInput
                v-else
                :model-value="textValue(plugin.id, field.key)"
                :type="field.type === 'number' ? 'number' : 'text'"
                :label="field.key"
                @update:model-value="setText(plugin.id, field.key, $event)"
              />
            </template>
            <FwbButton type="submit" :disabled="busy">Save</FwbButton>
          </form>

          <div class="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <p class="m-0 text-sm text-gray-600 dark:text-gray-400">Uninstall removes the plugin files. Sections that use it stay on the page until you remove them.</p>
            <FwbButton color="light" type="button" :disabled="busy" @click="run(plugin.id, 'uninstall')">Uninstall</FwbButton>
            <p class="m-0 text-sm text-gray-600 dark:text-gray-400">This is not undone from this screen. The activity log keeps a copy of these settings. To put the database back, use <NuxtLink to="/settings/backups" class="text-blue-700 underline dark:text-blue-300">Backups</NuxtLink>.</p>
            <FwbInput :model-value="confirmPhrase[plugin.pluginId] ?? ''" label="Type remove plugin data to confirm" @update:model-value="setPhrase(plugin.pluginId, $event)" />
            <FwbButton color="light" type="button" :disabled="busy || confirmPhrase[plugin.pluginId] !== 'remove plugin data'" @click="removeData(plugin.pluginId, plugin.id)">Remove plugin data</FwbButton>
          </div>
        </article>
      </section>

      <section v-if="leftovers.length" class="space-y-4">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">Saved settings left behind</h2>
        <article v-for="item in leftovers" :key="item.pluginId" class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ item.pluginId }}</h3>
          <p class="mt-2 mb-0 text-sm text-gray-600 dark:text-gray-400">This is not undone from this screen. The activity log keeps a copy of these settings. To put the database back, use <NuxtLink to="/settings/backups" class="text-blue-700 underline dark:text-blue-300">Backups</NuxtLink>.</p>
          <ul v-if="cardErrors[item.pluginId]?.length" class="mt-3 mb-0 list-none space-y-1 p-0">
            <li v-for="issue in cardErrors[item.pluginId]" :key="`${issue.path}-${issue.message}`" class="text-sm text-red-700 dark:text-red-400">{{ issue.path }}: {{ issue.message }}</li>
          </ul>
          <div class="mt-3 space-y-3">
            <FwbInput :model-value="confirmPhrase[item.pluginId] ?? ''" label="Type remove plugin data to confirm" @update:model-value="setPhrase(item.pluginId, $event)" />
            <FwbButton color="light" type="button" :disabled="busy || confirmPhrase[item.pluginId] !== 'remove plugin data'" @click="removeData(item.pluginId, item.pluginId)">Remove plugin data</FwbButton>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>
