<script setup lang="ts">
import { api, ApiError } from '../../../../utils/api'
import { CHANGE_STATUS_LABELS, when } from '../../../../utils/agents'
import type { PageDoc } from '#shared/page'
import type { PageDiff } from '#shared/diff'
import type { MenuDoc, SitePartDoc, SitePartKind } from '#shared/site-parts'
import type { Device } from '../../../../utils/page-editor'
import type { PageOption, SitePartDetail, SitePartListItem } from '../../../../utils/site-parts'
import ReviewPreview from '../../../../components/approvals/ReviewPreview.vue'
import SettingsNav from '../../../../components/settings/SettingsNav.vue'
import UndoDialog from '../../../../components/settings/agents/UndoDialog.vue'

definePageMeta({ layout: 'builder' })

interface PreviewItem {
  type: 'page' | 'site_part'
  id: string
  title: string
  path?: string
  kind?: SitePartKind
  created?: boolean
  doc: PageDoc | SitePartDoc | null
  hasBefore: boolean
  diff?: PageDiff | null
}
interface Preview {
  change: { id: string; title: string; status: keyof typeof CHANGE_STATUS_LABELS; reasonByAgent: string; tokenName: string; createdAt: string; publishedAt: string | null; undoOf: string | null; decision: { outcome?: string; reasons?: string[]; viaAlwaysAllow?: boolean } | null }
  mode: 'draft' | 'after_publish'
  undoable: boolean
  items: PreviewItem[]
}

const route = useRoute()
const { site } = useSession()
const id = computed(() => String(route.params.id))
const data = ref<Preview | null>(null)
const loading = ref(true)
const error = ref('')
const message = ref('')
const device = ref<Device>('desktop')
const showChanges = ref(true)
const undoing = ref(false)
const menus = ref<Record<string, MenuDoc>>({})
const pages = ref<PageOption[]>([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await api<Preview>(`/agent/changes/${id.value}/preview`)
    if (data.value.items.some((i) => i.type === 'site_part')) {
      const [pageData, partData] = await Promise.all([api<{ items: PageOption[] }>('/pages?page=1&pageSize=100'), api<{ items: SitePartListItem[] }>('/site-parts')])
      pages.value = pageData.items
      const loaded = await Promise.all(
        partData.items
          .filter((p) => p.kind === 'menu')
          .map(async (p) => [p.key, (await api<SitePartDetail>(`/site-parts/${p.id}`)).doc as MenuDoc] as const),
      )
      menus.value = Object.fromEntries(loaded)
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not open this change.'
  } finally {
    loading.value = false
  }
}
const approving = ref(false)
const approveError = ref('')
const pendingCount = computed(() => (data.value?.change.status === 'review' ? data.value.items.length : 0))
async function approveAll() {
  if (!data.value || !window.confirm(`Approve and publish all ${data.value.items.length} pages and parts in this change?`)) return
  approving.value = true
  approveError.value = ''
  try {
    const r = await api<{ approved: string[] }>(`/agent/changes/${data.value.change.id}/approve`, { method: 'POST', body: {} })
    message.value = `Approved and publishing: ${r.approved.join(', ')}.`
    await load()
  } catch (err) {
    approveError.value = err instanceof ApiError ? err.message : 'Could not approve this change.'
  } finally {
    approving.value = false
  }
}
function undone(text: string) {
  undoing.value = false
  message.value = text
  void load()
}
const summary = computed(() => {
  const c = data.value?.change
  if (!c) return ''
  if (c.status === 'open') return 'A draft. Nothing here is live.'
  if (c.status === 'review') return 'Waiting for a person to approve it in Approvals. Nothing here is live.'
  if (c.status === 'publishing') return 'Going live now.'
  if (c.status === 'published') return c.decision?.viaAlwaysAllow ? 'Live. It went live by always-allow.' : 'Live.'
  if (c.status === 'undone') return 'This change was undone. The pages show what is live now.'
  return `${CHANGE_STATUS_LABELS[c.status]}.`
})
/** Published (and the bare fallback) already open with the status word. Printing it again made "Live. Live." */
const statusLead = computed(() => {
  const c = data.value?.change
  if (!c) return ''
  const label = CHANGE_STATUS_LABELS[c.status]
  return summary.value.startsWith(label) ? '' : `${label}.`
})
const hasDiffs = computed(() => !!data.value?.items.some((i) => i.type === 'page' && i.hasBefore))
/** Fit the frame to what is in it: a full-height frame for pages with sections, a short one for menus, footers and empty pages. */
function frameClass(i: PreviewItem): string {
  if (i.type === 'site_part') return 'h-auto max-h-[60vh]'
  const blocks = (i.doc as PageDoc | null)?.blocks?.length ?? 0
  return blocks ? 'h-[70vh] min-h-[22rem]' : 'h-56'
}
/** The rule engine's reasons, only while they still matter (not after the change went live or was undone). */
const reasons = computed(() => {
  const c = data.value?.change
  if (!c?.decision?.reasons?.length || c.status === 'published' || c.status === 'undone' || c.status === 'publishing') return []
  return c.decision.reasons
})
const liveHref = (i: PreviewItem) => (site.value?.primaryDomain && i.path ? `https://${site.value.primaryDomain}${i.path}` : null)

onMounted(() => {
  // Phones see the phone layout first; the desktop frame would be shrunk to a third of its size.
  if (window.innerWidth < 768) device.value = 'mobile'
  void load()
})
</script>

<template>
  <div class="sb-page">
    <SettingsNav :back="{ to: '/settings/agents?tab=changes', label: 'Agents, changes' }">
      <template #title>
        <h1 class="m-0 break-words text-2xl font-semibold text-gray-900 dark:text-gray-100">{{ data?.change.title ?? 'Change' }}</h1>
      </template>
    </SettingsNav>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading…</p>
    <FwbAlert v-else-if="error" type="danger">{{ error }}</FwbAlert>
    <template v-else-if="data">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p class="m-0 min-w-0 text-sm text-gray-600 dark:text-gray-400"><strong v-if="statusLead">{{ statusLead }}</strong>{{ statusLead ? ' ' : '' }}{{ summary }} By <strong>{{ data.change.tokenName }}</strong>, {{ when(data.change.createdAt) }}. <code>{{ data.change.id }}</code></p>
        <div class="flex flex-wrap gap-2">
          <FwbButton v-if="pendingCount" :disabled="approving" @click="approveAll">{{ approving ? 'Approving…' : `Approve whole change (${pendingCount})` }}</FwbButton>
          <FwbButton v-if="data.undoable" color="red" @click="undoing = true">Undo this change</FwbButton>
        </div>
      </div>
      <FwbAlert v-if="message" type="success" class="mb-4">{{ message }}</FwbAlert>
      <FwbAlert v-if="approveError" type="danger" class="mb-4">{{ approveError }}</FwbAlert>
      <p class="mb-2 max-w-3xl rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm text-gray-700 dark:text-gray-300">
        <span class="text-gray-500 dark:text-gray-400">The agent's own words for why (not proof of what anyone asked):</span> “{{ data.change.reasonByAgent }}”
      </p>
      <details v-if="reasons.length" class="mb-4 max-w-3xl text-sm text-gray-700 dark:text-gray-300" :open="reasons.length <= 2">
        <summary class="cursor-pointer font-medium">Why this needs a person ({{ reasons.length }})</summary>
        <ul class="m-0 mt-2 list-disc space-y-1 pl-5">
          <li v-for="(r, i) in reasons" :key="i" class="break-words">{{ r }}</li>
        </ul>
      </details>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <FwbButton size="sm" :color="device === 'desktop' ? 'default' : 'light'" @click="device = 'desktop'">Desktop</FwbButton>
        <FwbButton size="sm" :color="device === 'mobile' ? 'default' : 'light'" @click="device = 'mobile'">Phone</FwbButton>
        <label v-if="hasDiffs" class="ml-2 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="showChanges" type="checkbox" /> Mark what changed</label>
      </div>

      <section v-for="item in data.items" :key="`${item.type}-${item.id}`" class="mb-8" :data-testid="`preview-${item.id}`">
        <div class="mb-2 flex flex-wrap items-baseline gap-2">
          <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">{{ item.title }}</h2>
          <span v-if="item.path" class="text-sm text-gray-500 dark:text-gray-400">{{ item.path }}</span>
          <span v-if="item.created" class="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">New page</span>
          <a v-if="liveHref(item) && data.mode === 'after_publish'" :href="liveHref(item)!" class="text-sm" target="_blank" rel="noopener">Open on the site</a>
        </div>
        <div v-if="item.doc" class="flex" :class="frameClass(item)">
          <ReviewPreview
            :kind="item.type"
            :site-part-kind="item.kind"
            :doc="item.doc"
            :diff="item.diff ?? undefined"
            :show-changes="showChanges && item.hasBefore"
            :device="device"
            :site-name="site?.name ?? ''"
            :menus="menus"
            :pages="pages"
          />
        </div>
        <p v-else class="text-sm text-gray-500 dark:text-gray-400">Nothing to show for this one.</p>
      </section>
    </template>
    <UndoDialog v-if="undoing && data" :change-id="data.change.id" :title="data.change.title" @close="undoing = false" @done="undone" />
  </div>
</template>
