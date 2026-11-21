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
  <div class="sb-page">
    <UiPageHeader title="Page types" description="Rules for which sections a page may and must have. Changes go through approval before they apply to new and existing pages.">
      <FwbButton v-if="canEdit" @click="showNew = true"><span class="inline-flex items-center gap-1.5"><UiIcon name="plus" :size="16" /> New page type</span></FwbButton>
    </UiPageHeader>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <form v-if="showNew && canEdit" class="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900" @submit.prevent="create">
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
    <UiCardGrid v-if="loading">
      <div v-for="n in 3" :key="n" class="h-36 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />
    </UiCardGrid>
    <UiEmptyState v-else-if="!items.length" icon="templates" title="No page types yet" description="Page types decide which sections a page can have." />
    <UiCardGrid v-else>
      <UiCard v-for="item in items" :key="item.id" :to="`/templates/${item.id}`">
        <div class="flex items-start justify-between gap-3">
          <span class="grid size-10 place-items-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><UiIcon name="templates" /></span>
          <span class="sb-status" :class="`sb-status-${item.state}`">{{ statusLabel(item.state, item.hasUnpublishedChanges) }}</span>
        </div>
        <h2 class="mt-4 mb-0 text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">{{ item.label }}</h2>
        <p class="mt-1 mb-0 font-mono text-xs text-gray-500 dark:text-gray-400">{{ item.key }}</p>
        <p class="mt-auto mb-0 inline-flex items-center gap-1 pt-4 text-xs text-gray-500 dark:text-gray-400"><UiIcon name="clock" :size="13" /> Edited {{ timeAgo(item.updatedAt) }}</p>
      </UiCard>
    </UiCardGrid>
  </div>
</template>
