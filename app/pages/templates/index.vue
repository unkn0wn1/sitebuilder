<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { statusLabel, type WorkflowState } from '#shared/workflow'
import { can } from '#shared/roles'
import { timeAgo } from '../../utils/format'

definePageMeta({ layout: 'builder' })

interface TemplateItem {
  id: string
  key: string
  label: string
  state: WorkflowState
  live: boolean
  hasUnpublishedChanges: boolean
  updatedAt: string
}

const { user } = useSession()
const canEdit = computed(() => user.value && can(user.value, 'template.edit'))
const items = ref<TemplateItem[]>([])
const loading = ref(true)
const error = ref('')
const showNew = ref(false)
const creating = ref(false)
const newLabel = ref('')
const newKey = ref('')
const keyTouched = ref(false)

function keyFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

watch(newLabel, (value) => {
  if (!keyTouched.value) newKey.value = keyFromLabel(value)
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: TemplateItem[] }>('/templates')
    items.value = data.items
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load page types.'
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!newLabel.value.trim() || !newKey.value.trim()) return
  creating.value = true
  error.value = ''
  try {
    const created = await api<{ id: string }>('/templates', {
      method: 'POST',
      body: { key: newKey.value.trim().toLowerCase(), rules: { label: newLabel.value.trim(), allowedBlocks: ['RichText'], requiredBlocks: [], startingBlocks: [] } },
    })
    await navigateTo(`/templates/${created.id}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not create that page type.'
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Page types</h1>
        <p class="mt-1 mb-0 max-w-xl text-gray-600 dark:text-gray-400">Rules for what sections a page may and must have. Changes go through approval before they apply to new and existing pages.</p>
      </div>
      <FwbButton v-if="canEdit" @click="showNew = true">New page type</FwbButton>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <form v-if="showNew && canEdit" class="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" @submit.prevent="create">
      <div class="w-56">
        <FwbInput v-model="newLabel" label="Name" placeholder="Campaign" />
      </div>
      <div class="w-48">
        <FwbInput v-model="newKey" label="Key" placeholder="campaign" @input="keyTouched = true" />
      </div>
      <FwbButton type="submit" :disabled="creating">{{ creating ? 'Creating…' : 'Create' }}</FwbButton>
      <FwbButton color="light" type="button" @click="showNew = false">Cancel</FwbButton>
      <p class="m-0 w-full text-sm text-gray-500 dark:text-gray-400">The key is used in the address of this type and can't be changed later. New types start as a draft and must be approved before editors can use them.</p>
    </form>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading page types…</p>
    <p v-else-if="!items.length" class="text-gray-500 dark:text-gray-400">No page types yet.</p>
    <FwbTable v-else hoverable>
      <FwbTableHead>
        <FwbTableHeadCell>Name</FwbTableHeadCell>
        <FwbTableHeadCell>Key</FwbTableHeadCell>
        <FwbTableHeadCell>Status</FwbTableHeadCell>
        <FwbTableHeadCell>Updated</FwbTableHeadCell>
      </FwbTableHead>
      <FwbTableBody>
        <FwbTableRow v-for="item in items" :key="item.id">
          <FwbTableCell>
            <NuxtLink :to="`/templates/${item.id}`" class="font-medium text-gray-900 dark:text-gray-100 no-underline hover:underline">{{ item.label }}</NuxtLink>
          </FwbTableCell>
          <FwbTableCell class="text-gray-600 dark:text-gray-400">{{ item.key }}</FwbTableCell>
          <FwbTableCell>{{ statusLabel(item.state, item.hasUnpublishedChanges) }}</FwbTableCell>
          <FwbTableCell>{{ timeAgo(item.updatedAt) }}</FwbTableCell>
        </FwbTableRow>
      </FwbTableBody>
    </FwbTable>
  </div>
</template>
