<script setup lang="ts">
import { api, ApiError, waitForJob } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { can } from '#shared/roles'
import { REVIEW_STATE_LABELS } from '#shared/workflow'
import type { PageDoc } from '#shared/page'
import type { MenuDoc, SitePartDoc } from '#shared/site-parts'
import { blockRegistry } from '../../utils/block-fields'
import { CHANGE_KIND_LABELS, type ReviewDetail } from '../../utils/reviews'
import type { PageOption, SitePartDetail, SitePartListItem } from '../../utils/site-parts'
import type { Device } from '../../utils/page-editor'
import ReviewPreview from '../../components/approvals/ReviewPreview.vue'
import PublishProgress from '../../components/approvals/PublishProgress.vue'

definePageMeta({ layout: 'builder' })

const route = useRoute()
const { user, site } = useSession()
const id = computed(() => String(route.params.id))

const detail = ref<ReviewDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const device = ref<Device>('desktop')
const mode = ref<'preview' | 'changes'>('preview')
const comment = ref('')
const sending = ref(false)
const showSendBack = ref(false)
const sendBackComment = ref('')
const showOverride = ref(false)
const overrideReason = ref('')
const deciding = ref(false)
const job = ref<{ state: string; lastError: string | null } | null>(null)
const menuDocs = ref<Record<string, MenuDoc>>({})
const pages = ref<PageOption[]>([])

const canDecide = computed(() => !!user.value && can(user.value, 'review.decide'))
const isPending = computed(() => detail.value?.review.state === 'pending')
const isOwn = computed(() => !!user.value && detail.value?.review.submittedBy === user.value.id)
const blocked = computed(() => !!detail.value?.checks.blocking.length)
const approveDisabled = computed(() => {
  if (!canDecide.value || !isPending.value || deciding.value) return true
  if (detail.value?.draftChangedSinceSubmit) return true
  if (blocked.value) return true
  return false
})

const changeLines = computed(() => {
  const d = detail.value
  if (!d) return []
  const lines: { key: string; text: string; blockId?: string }[] = []
  if (d.review.changeSummary) lines.push({ key: 'summary', text: d.review.changeSummary })
  for (const change of d.diff?.blocks ?? []) {
    const label = blockRegistry.get(change.type)?.label ?? change.type
    lines.push({ key: `${change.kind}-${change.blockId}`, text: `${CHANGE_KIND_LABELS[change.kind]}: ${label}`, blockId: change.blockId })
  }
  for (const key of d.diff?.meta ?? []) {
    if (key === 'title') lines.push({ key: 'meta-title', text: 'Changed the title' })
    else if (key.startsWith('seo.')) lines.push({ key: `meta-${key}`, text: 'Changed search settings' })
  }
  return lines
})

const liveHref = computed(() => {
  const d = detail.value
  if (!d) return null
  if (d.target.type === 'site_part') return `/site-parts/${d.target.id}`
  if (d.target.type === 'brand') return '/brand'
  if (d.target.type === 'template') return `/templates/${d.target.id}`
  const domain = site.value?.primaryDomain
  if (domain && d.target.path) return `https://${domain}${d.target.path}`
  return `/pages/${d.target.id}`
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api<ReviewDetail>(`/reviews/${id.value}`)
    detail.value = data
    mode.value = data.hasLive ? 'changes' : 'preview'
    if (data.review.jobId && (data.review.state === 'approved' || data.review.state === 'published' || data.review.state === 'failed')) {
      void followJob(data.review.jobId)
    }
    if (data.target.type === 'site_part') {
      const [pageData, partData] = await Promise.all([
        api<{ items: PageOption[] }>('/pages?page=1&pageSize=100'),
        api<{ items: SitePartListItem[] }>('/site-parts'),
      ])
      pages.value = pageData.items
      const loaded = await Promise.all(
        partData.items
          .filter((item) => item.kind === 'menu')
          .map(async (item) => {
            const part = await api<SitePartDetail>(`/site-parts/${item.id}`)
            return [item.key, part.doc as MenuDoc] as const
          }),
      )
      menuDocs.value = Object.fromEntries(loaded)
    }
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not open this review.'
  } finally {
    loading.value = false
  }
}

async function followJob(jobId: string) {
  try {
    job.value = await waitForJob(jobId, 60_000)
    await loadQuiet()
  } catch (err) {
    job.value = { state: 'failed', lastError: err instanceof ApiError ? err.message : 'Publishing is taking longer than expected.' }
  }
}

async function loadQuiet() {
  try {
    detail.value = await api<ReviewDetail>(`/reviews/${id.value}`)
  } catch {
    /* keep the current view */
  }
}

async function addComment() {
  const body = comment.value.trim()
  if (!body || !detail.value) return
  sending.value = true
  actionError.value = ''
  try {
    await api(`/reviews/${detail.value.review.id}/comments`, { method: 'POST', body: { body } })
    comment.value = ''
    await loadQuiet()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Could not add that comment.'
  } finally {
    sending.value = false
  }
}

async function sendBack() {
  if (!detail.value || !sendBackComment.value.trim()) return
  deciding.value = true
  actionError.value = ''
  try {
    await api(`/reviews/${detail.value.review.id}/send-back`, { method: 'POST', body: { comment: sendBackComment.value.trim() } })
    showSendBack.value = false
    await load()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Could not send this back.'
  } finally {
    deciding.value = false
  }
}

async function approve(withOverride = false) {
  if (!detail.value) return
  if (blocked.value && !withOverride) {
    showOverride.value = true
    return
  }
  if (blocked.value && overrideReason.value.trim().length < 5) return
  deciding.value = true
  actionError.value = ''
  try {
    const result = await api<{ jobId: string }>(`/reviews/${detail.value.review.id}/approve`, {
      method: 'POST',
      body: {
        versionId: detail.value.review.versionId,
        ...(blocked.value ? { overrideReason: overrideReason.value.trim() } : {}),
      },
    })
    showOverride.value = false
    job.value = { state: 'queued', lastError: null }
    void followJob(result.jobId)
    await loadQuiet()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Could not approve this.'
  } finally {
    deciding.value = false
  }
}

function scrollTo(blockId?: string) {
  if (!blockId) return
  document.getElementById(`block-${blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(id, load, { immediate: true })
</script>

<template>
  <div>
    <p v-if="loading" class="p-8 text-gray-500 dark:text-gray-400">Opening the review…</p>
    <div v-else-if="loadError" class="p-6">
      <FwbAlert type="danger">{{ loadError }}</FwbAlert>
      <NuxtLink to="/approvals" class="mt-4 inline-block text-sm">Back to approvals</NuxtLink>
    </div>
    <div v-else-if="detail" class="flex min-h-0 min-w-0 flex-col md:h-[calc(100vh-3.25rem)]">
      <header class="flex min-w-0 flex-wrap items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 sm:px-4">
        <NuxtLink to="/approvals" class="text-sm text-gray-600 dark:text-gray-400 no-underline hover:underline">&lt; Approvals</NuxtLink>
        <h1 class="m-0 min-w-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100">Review: {{ detail.target.title }}</h1>
        <span class="text-sm text-gray-500 dark:text-gray-400">by {{ detail.submittedByName }}, {{ timeAgo(detail.review.createdAt) }}</span>
        <span class="sb-status sb-status-in_review">{{ REVIEW_STATE_LABELS[detail.review.state] }}</span>
        <div class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <FwbButton v-if="canDecide && isPending" size="sm" color="light" :disabled="deciding || detail.draftChangedSinceSubmit" @click="showSendBack = true">
            Send back
          </FwbButton>
          <FwbButton v-if="canDecide && isPending" size="sm" :disabled="approveDisabled" @click="approve(blocked && showOverride)">
            {{ deciding ? 'Approving…' : 'Approve and publish' }}
          </FwbButton>
        </div>
      </header>
      <FwbAlert v-if="actionError" type="danger" class="rounded-none">{{ actionError }}</FwbAlert>
      <FwbAlert v-else-if="detail.draftChangedSinceSubmit" type="warning" class="rounded-none">
        This changed after it was submitted. It needs submitting again before it can be approved.
      </FwbAlert>
      <p v-else-if="isOwn && isPending" class="m-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
        You submitted this. If self-approval isn't on in Settings, another approver will need to approve it.
      </p>

      <div v-if="job || detail.review.state === 'approved' || detail.review.state === 'published' || detail.review.state === 'failed'" class="p-4">
        <PublishProgress
          :job-state="job?.state ?? (detail.review.state === 'published' ? 'done' : detail.review.state === 'failed' ? 'failed' : 'running')"
          :last-error="job?.lastError"
          :is-site-part="detail.target.type === 'site_part' || detail.target.type === 'brand'"
          :view-href="detail.review.state === 'published' || job?.state === 'done' ? liveHref : null"
          :title="detail.target.title"
        />
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-2">
            <FwbButtonGroup>
              <FwbButton size="sm" :color="device === 'desktop' ? 'default' : 'light'" @click="device = 'desktop'">Desktop</FwbButton>
              <FwbButton size="sm" :color="device === 'tablet' ? 'default' : 'light'" @click="device = 'tablet'">Tablet</FwbButton>
              <FwbButton size="sm" :color="device === 'mobile' ? 'default' : 'light'" @click="device = 'mobile'">Mobile</FwbButton>
            </FwbButtonGroup>
            <FwbButtonGroup>
              <FwbButton size="sm" :color="mode === 'preview' ? 'default' : 'light'" @click="mode = 'preview'">Preview</FwbButton>
              <FwbButton size="sm" :color="mode === 'changes' ? 'default' : 'light'" @click="mode = 'changes'">Show changes</FwbButton>
            </FwbButtonGroup>
          </div>
          <p v-if="detail.target.type === 'brand'" class="p-8 text-sm text-gray-600 dark:text-gray-400">This is a brand and design change. Checks and the summary are in the right-hand column. After publish, every page is updated (about a minute).</p>
          <div v-else-if="detail.target.type === 'template'" class="p-8 text-sm text-gray-700 dark:text-gray-300">
            <p class="mt-0">This is a page type change. After it is published, the new rules apply when people edit or submit pages of this type. Existing live pages are not re-rendered.</p>
            <p v-if="'allowedBlocks' in detail.doc && Array.isArray(detail.doc.allowedBlocks)" class="mb-0">
              Allowed: {{ detail.doc.allowedBlocks.join(', ') }}.
              Required: {{ detail.doc.requiredBlocks.length ? detail.doc.requiredBlocks.join(', ') : 'none' }}.
            </p>
          </div>
          <ReviewPreview
            v-else
            :kind="detail.target.type"
            :site-part-kind="detail.target.type === 'site_part' ? detail.target.kind : undefined"
            :doc="detail.doc as PageDoc | SitePartDoc"
            :diff="detail.diff"
            :show-changes="mode === 'changes'"
            :device="device"
            :site-name="site?.name ?? 'This site'"
            :menus="menuDocs"
            :pages="pages"
          />
        </div>
        <aside class="min-h-0 overflow-auto border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 md:border-t-0 md:border-l">
          <section v-if="detail.review.note" class="mb-5">
            <h2 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{{ detail.submittedByName }}'s note</h2>
            <p class="m-0 text-sm text-gray-700 dark:text-gray-300">{{ detail.review.note }}</p>
          </section>
          <section class="mb-5">
            <h2 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Changes</h2>
            <ul v-if="changeLines.length" class="m-0 list-none space-y-1 p-0 text-sm">
              <li v-for="line in changeLines" :key="line.key">
                <button v-if="line.blockId" type="button" class="text-left text-blue-700 dark:text-blue-400 hover:underline" @click="scrollTo(line.blockId)">{{ line.text }}</button>
                <span v-else class="text-gray-700 dark:text-gray-300">{{ line.text }}</span>
              </li>
            </ul>
            <p v-else class="m-0 text-sm text-gray-500 dark:text-gray-400">No section-level changes listed.</p>
          </section>
          <section class="mb-5">
            <h2 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Checks</h2>
            <ul class="m-0 list-none space-y-2 p-0 text-sm">
              <li v-for="(issue, i) in detail.checks.blocking" :key="`b-${i}`" class="text-red-800 dark:text-red-200">{{ issue.message }}</li>
              <li v-for="(issue, i) in detail.checks.warnings" :key="`w-${i}`" class="text-amber-800">{{ issue.message }}</li>
              <li v-if="!detail.checks.blocking.length && !detail.checks.warnings.length" class="text-gray-600 dark:text-gray-400">All checks passed.</li>
            </ul>
            <button
              v-if="blocked && canDecide && isPending && !detail.draftChangedSinceSubmit"
              type="button"
              class="mt-2 text-sm text-blue-700 dark:text-blue-400 hover:underline"
              @click="showOverride = true"
            >
              Override
            </button>
          </section>
          <section>
            <h2 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Comments</h2>
            <ul class="m-0 mb-3 list-none space-y-3 p-0 text-sm">
              <li v-for="item in detail.comments" :key="item.id">
                <p class="mb-0.5 font-medium text-gray-800 dark:text-gray-200">{{ item.authorName }} <span class="font-normal text-gray-500 dark:text-gray-400">{{ timeAgo(item.createdAt) }}</span></p>
                <p class="m-0 text-gray-700 dark:text-gray-300">{{ item.body }}</p>
              </li>
            </ul>
            <form class="space-y-2" @submit.prevent="addComment">
              <textarea v-model="comment" rows="3" class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 p-2.5 text-sm" placeholder="Add a comment…" />
              <FwbButton size="sm" :disabled="sending || !comment.trim()" type="submit">{{ sending ? 'Sending…' : 'Add comment' }}</FwbButton>
            </form>
          </section>
        </aside>
      </div>
    </div>

    <FwbModal v-if="showSendBack" @close="showSendBack = false">
      <template #header>Send back</template>
      <template #body>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">Add a comment so they know what to change.</p>
        <textarea v-model="sendBackComment" rows="4" class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 p-2.5 text-sm" required />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showSendBack = false">Cancel</FwbButton>
          <FwbButton :disabled="deciding || !sendBackComment.trim()" @click="sendBack">{{ deciding ? 'Sending…' : 'Send back' }}</FwbButton>
        </div>
      </template>
    </FwbModal>

    <FwbModal v-if="showOverride" @close="showOverride = false">
      <template #header>Approve with problems left in</template>
      <template #body>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">There are problems to fix. If you still want to publish, say why. This is logged.</p>
        <ul class="mb-3 list-disc pl-5 text-sm text-red-800 dark:text-red-200">
          <li v-for="(issue, i) in detail?.checks.blocking" :key="i">{{ issue.message }}</li>
        </ul>
        <textarea v-model="overrideReason" rows="3" class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 p-2.5 text-sm" placeholder="Reason (at least 5 characters)" />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showOverride = false">Cancel</FwbButton>
          <FwbButton :disabled="deciding || overrideReason.trim().length < 5" @click="approve(true)">{{ deciding ? 'Approving…' : 'Approve and publish' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
