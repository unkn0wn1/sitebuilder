<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { REVIEW_STATE_LABELS, type ReviewState } from '#shared/workflow'
import type { ReviewListItem } from '../../utils/reviews'

definePageMeta({ layout: 'builder' })

const items = ref<ReviewListItem[]>([])
const filter = ref<'pending' | 'all'>('pending')
const error = ref('')
const loading = ref(true)

const shown = computed(() => (filter.value === 'pending' ? items.value.filter((i) => i.state === 'pending') : items.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: ReviewListItem[] }>(filter.value === 'pending' ? '/reviews?state=pending' : '/reviews')
    items.value = data.items
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load reviews.'
  } finally {
    loading.value = false
  }
}

watch(filter, load, { immediate: true })
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900">Approvals</h1>
        <p class="mt-1 text-sm text-gray-600">Review submitted pages and site parts, then publish or send them back.</p>
      </div>
      <FwbButtonGroup>
        <FwbButton size="sm" :color="filter === 'pending' ? 'default' : 'light'" @click="filter = 'pending'">Waiting</FwbButton>
        <FwbButton size="sm" :color="filter === 'all' ? 'default' : 'light'" @click="filter = 'all'">All</FwbButton>
      </FwbButtonGroup>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="loading" class="text-gray-500">Loading reviews…</p>
    <p v-else-if="!shown.length" class="text-gray-500">{{ filter === 'pending' ? 'Nothing waiting. Nice work.' : 'No reviews yet.' }}</p>
    <FwbTable v-else hoverable>
      <FwbTableHead>
        <FwbTableHeadCell>Item</FwbTableHeadCell>
        <FwbTableHeadCell>Status</FwbTableHeadCell>
        <FwbTableHeadCell>Submitted</FwbTableHeadCell>
        <FwbTableHeadCell>Summary</FwbTableHeadCell>
      </FwbTableHead>
      <FwbTableBody>
        <FwbTableRow v-for="item in shown" :key="item.id">
          <FwbTableCell>
            <NuxtLink :to="`/approvals/${item.id}`" class="font-medium text-gray-900 no-underline hover:underline">{{ item.title }}</NuxtLink>
            <p class="m-0 text-sm text-gray-500">{{ item.targetType === 'site_part' ? 'Site part' : item.targetType === 'brand' ? 'Brand and Design' : item.targetType === 'template' ? 'Page type' : 'Page' }}</p>
          </FwbTableCell>
          <FwbTableCell>
            <span class="sb-status" :class="item.state === 'pending' ? 'sb-status-in_review' : item.state === 'published' ? 'sb-status-published' : 'sb-status-draft'">
              {{ REVIEW_STATE_LABELS[item.state as ReviewState] }}
            </span>
          </FwbTableCell>
          <FwbTableCell class="text-gray-600">{{ item.submittedByName }}, {{ timeAgo(item.createdAt) }}</FwbTableCell>
          <FwbTableCell class="text-gray-600">{{ item.changeSummary || '—' }}</FwbTableCell>
        </FwbTableRow>
      </FwbTableBody>
    </FwbTable>
  </div>
</template>
