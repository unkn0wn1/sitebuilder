<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { KIND_LABELS, type SitePartListItem } from '../../utils/site-parts'

const KIND_ORDER: Record<SitePartListItem['kind'], number> = { header: 0, footer: 1, menu: 2, banner: 3 }

definePageMeta({ layout: 'builder' })

const items = ref<SitePartListItem[]>([])
const error = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: SitePartListItem[] }>('/site-parts')
    items.value = data.items.slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label))
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the header, footer and menus.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Site parts</h1>
      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">The header, footer and menus appear on every page. Changes go through approval, like pages do.</p>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading site parts…</p>
    <p v-else-if="!items.length" class="text-gray-500 dark:text-gray-400">No site parts yet.</p>
    <FwbTable v-else hoverable>
      <FwbTableHead>
        <FwbTableHeadCell>Name</FwbTableHeadCell>
        <FwbTableHeadCell>Kind</FwbTableHeadCell>
        <FwbTableHeadCell>Status</FwbTableHeadCell>
        <FwbTableHeadCell>Last edited</FwbTableHeadCell>
      </FwbTableHead>
      <FwbTableBody>
        <FwbTableRow v-for="part in items" :key="part.id">
          <FwbTableCell>
            <NuxtLink :to="`/site-parts/${part.id}`" class="font-medium text-gray-900 dark:text-gray-100 no-underline hover:underline">{{ part.label }}</NuxtLink>
          </FwbTableCell>
          <FwbTableCell class="text-gray-600 dark:text-gray-400">{{ KIND_LABELS[part.kind] }}</FwbTableCell>
          <FwbTableCell>
            <BuilderStatusBadge :state="part.state" :has-unpublished-changes="part.hasUnpublishedChanges" />
          </FwbTableCell>
          <FwbTableCell class="text-gray-600 dark:text-gray-400">{{ timeAgo(part.updatedAt) }}</FwbTableCell>
        </FwbTableRow>
      </FwbTableBody>
    </FwbTable>
  </div>
</template>
