<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import type { WorkflowState } from '#shared/workflow'
import { can } from '#shared/roles'

definePageMeta({ layout: 'builder' })

interface PageItem {
  id: string
  title: string
  path: string | null
  template: string
  state: WorkflowState
  hasUnpublishedChanges: boolean
  updatedAt: string
}

const { user } = useSession()
const items = ref<PageItem[]>([])
const total = ref(0)
const search = ref('')
const state = ref('')
const error = ref('')
const loading = ref(true)
const creating = ref(false)
const showNew = ref(false)
const newTitle = ref('')
const newTemplate = ref('standard')
const templates = ref<{ key: string; label: string }[]>([])

const canEdit = computed(() => user.value && can(user.value, 'page.edit'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = new URLSearchParams()
    if (search.value) q.set('search', search.value)
    if (state.value) q.set('state', state.value)
    const data = await api<{ items: PageItem[]; total: number }>(`/pages?${q.toString()}`)
    items.value = data.items
    total.value = data.total
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load pages.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try {
    const data = await api<{ items: { key: string; label: string; live?: boolean }[] }>('/templates')
    templates.value = data.items.filter((item) => item.live !== false)
    if (templates.value.some((t) => t.key === 'standard')) newTemplate.value = 'standard'
    else if (templates.value[0]) newTemplate.value = templates.value[0].key
  } catch {
    templates.value = [
      { key: 'standard', label: 'Standard' },
      { key: 'home', label: 'Home' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'story', label: 'Story' },
    ]
  }
})

async function createPage() {
  if (!newTitle.value.trim()) return
  creating.value = true
  error.value = ''
  try {
    const data = await api<{ page: { id: string } }>('/pages', { method: 'POST', body: { title: newTitle.value.trim(), template: newTemplate.value } })
    showNew.value = false
    await navigateTo(`/pages/${data.page.id}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not create that page.'
  } finally {
    creating.value = false
  }
}

const states = [
  { value: '', name: 'All' },
  { value: 'draft', name: 'Drafts' },
  { value: 'in_review', name: 'Waiting for approval' },
  { value: 'published', name: 'Live' },
  { value: 'unpublished', name: 'Offline' },
]
const templateLabel = (key: string) => templates.value.find((t) => t.key === key)?.label ?? key
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 250)
})
function setState(value: string) {
  state.value = value
  void load()
}
</script>

<template>
  <div class="sb-page">
    <UiPageHeader title="Pages" description="Every page on the site. Changes go live after approval.">
      <template v-if="canEdit">
        <FwbButton color="light" @click="navigateTo('/pages/new-assistant')">
          <span class="inline-flex items-center gap-2"><UiIcon name="sparkles" :size="16" /> New page with the assistant</span>
        </FwbButton>
        <FwbButton @click="showNew = true">
          <span class="inline-flex items-center gap-2"><UiIcon name="plus" :size="16" /> New page</span>
        </FwbButton>
      </template>
    </UiPageHeader>

    <div class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        <button
          v-for="s in states"
          :key="s.value"
          type="button"
          class="rounded-full border px-3 py-1 text-sm font-medium transition"
          :class="state === s.value ? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'"
          :aria-pressed="state === s.value"
          @click="setState(s.value)"
        >
          {{ s.name }}
        </button>
      </div>
      <label class="relative block w-full md:w-80">
        <span class="sr-only">Search pages</span>
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400"><UiIcon name="search" :size="16" /></span>
        <input v-model="search" type="search" placeholder="Search pages" class="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
      </label>
    </div>

    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <UiCardGrid v-if="loading">
      <div v-for="n in 6" :key="n" class="h-36 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />
    </UiCardGrid>
    <UiEmptyState v-else-if="!items.length" icon="pages" :title="search || state ? 'No pages match' : 'No pages yet'" :description="search || state ? 'Try another word, or show all pages.' : 'Start with a page for your next appeal, or let the assistant draft one with you.'">
      <FwbButton v-if="search || state" color="light" @click="search = ''; setState('')">Show all pages</FwbButton>
      <FwbButton v-else-if="canEdit" @click="showNew = true">New page</FwbButton>
    </UiEmptyState>
    <UiCardGrid v-else>
      <UiCard v-for="page in items" :key="page.id" :to="`/pages/${page.id}`">
        <div class="flex items-start justify-between gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"><UiIcon name="pages" /></span>
          <BuilderStatusBadge :state="page.state" :has-unpublished-changes="page.hasUnpublishedChanges" />
        </div>
        <h2 class="mt-4 mb-0 break-words text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">{{ page.title }}</h2>
        <p class="mt-1 mb-0 truncate font-mono text-xs text-gray-500 dark:text-gray-400">{{ page.path || 'No address yet' }}</p>
        <div class="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-gray-500 dark:text-gray-400">
          <span class="rounded-md bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">{{ templateLabel(page.template) }}</span>
          <span class="inline-flex items-center gap-1"><UiIcon name="clock" :size="13" /> {{ timeAgo(page.updatedAt) }}</span>
        </div>
      </UiCard>
    </UiCardGrid>
    <p v-if="total && !loading" class="mt-4 text-sm text-gray-500 dark:text-gray-400">{{ total }} {{ total === 1 ? 'page' : 'pages' }}</p>

    <FwbModal v-if="showNew" @close="showNew = false">
      <template #header>New page</template>
      <template #body>
        <form class="flex flex-col gap-4" @submit.prevent="createPage">
          <FwbInput v-model="newTitle" label="Title" required />
          <div>
            <p class="mb-2 text-sm font-medium text-gray-900 dark:text-white">Page type</p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label v-for="t in templates" :key="t.key" class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 dark:border-gray-700 dark:has-[:checked]:bg-blue-500/10">
                <input v-model="newTemplate" type="radio" :value="t.key" class="text-blue-600" />
                <span class="font-medium text-gray-900 dark:text-white">{{ t.label }}</span>
              </label>
            </div>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showNew = false">Cancel</FwbButton>
          <FwbButton :disabled="creating || !newTitle.trim()" @click="createPage">{{ creating ? 'Creating…' : 'Create page' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
