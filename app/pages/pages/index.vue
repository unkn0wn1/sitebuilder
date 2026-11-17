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
    const data = await api<{ items: { key: string; label: string }[] }>('/templates')
    templates.value = data.items
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
  { value: 'draft', name: 'Draft' },
  { value: 'in_review', name: 'Waiting for approval' },
  { value: 'published', name: 'Live' },
  { value: 'unpublished', name: 'Offline' },
]
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-gray-900">Pages</h1>
      <FwbButton v-if="canEdit" @click="showNew = true">New page</FwbButton>
    </div>
    <div class="mb-4 flex flex-wrap gap-3">
      <div class="w-72">
        <FwbInput v-model="search" placeholder="Search pages" @keyup.enter="load" />
      </div>
      <div class="w-56">
        <FwbSelect v-model="state" :options="states" @change="load" />
      </div>
      <FwbButton color="light" @click="load">Search</FwbButton>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="loading" class="text-gray-500">Loading pages…</p>
    <p v-else-if="!items.length" class="text-gray-500">No pages yet.</p>
    <FwbTable v-else hoverable>
      <FwbTableHead>
        <FwbTableHeadCell>Title</FwbTableHeadCell>
        <FwbTableHeadCell>Status</FwbTableHeadCell>
        <FwbTableHeadCell>Last edited</FwbTableHeadCell>
        <FwbTableHeadCell>Address</FwbTableHeadCell>
      </FwbTableHead>
      <FwbTableBody>
        <FwbTableRow v-for="page in items" :key="page.id">
          <FwbTableCell>
            <NuxtLink :to="`/pages/${page.id}`" class="font-medium text-gray-900 no-underline hover:underline">{{ page.title }}</NuxtLink>
          </FwbTableCell>
          <FwbTableCell>
            <BuilderStatusBadge :state="page.state" :has-unpublished-changes="page.hasUnpublishedChanges" />
          </FwbTableCell>
          <FwbTableCell class="text-gray-600">{{ timeAgo(page.updatedAt) }}</FwbTableCell>
          <FwbTableCell class="text-gray-600">{{ page.path || '—' }}</FwbTableCell>
        </FwbTableRow>
      </FwbTableBody>
    </FwbTable>
    <p v-if="total" class="mt-3 text-sm text-gray-500">{{ total }} {{ total === 1 ? 'page' : 'pages' }}</p>

    <FwbModal v-if="showNew" @close="showNew = false">
      <template #header>New page</template>
      <template #body>
        <form class="flex flex-col gap-4" @submit.prevent="createPage">
          <FwbInput v-model="newTitle" label="Title" required />
          <FwbSelect v-model="newTemplate" label="Page type" :options="templates.map((t) => ({ value: t.key, name: t.label }))" />
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
