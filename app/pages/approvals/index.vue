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

const TYPE: Record<string, { label: string; icon: 'pages' | 'parts' | 'brand' | 'templates' }> = {
  page: { label: 'Page', icon: 'pages' },
  site_part: { label: 'Site part', icon: 'parts' },
  brand: { label: 'Brand and Design', icon: 'brand' },
  template: { label: 'Page type', icon: 'templates' },
}
const stateClass = (state: string) => (state === 'pending' ? 'sb-status-in_review' : state === 'published' ? 'sb-status-published' : 'sb-status-draft')
</script>

<template>
  <div class="sb-page">
    <UiPageHeader title="Approvals" description="Changes waiting for a second pair of eyes. Open one to see it on the real page, then publish it or send it back.">
      <UiSegmented v-model="filter" label="Show" :options="[{ value: 'pending', label: 'Waiting' }, { value: 'all', label: 'All' }]" />
    </UiPageHeader>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <UiCardGrid v-if="loading">
      <div v-for="n in 3" :key="n" class="h-40 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />
    </UiCardGrid>
    <UiEmptyState v-else-if="!shown.length" icon="approvals" :title="filter === 'pending' ? 'Nothing waiting' : 'No reviews yet'" :description="filter === 'pending' ? 'When someone submits a page or a site part, it shows up here.' : 'Submitted changes and what happened to them will be listed here.'">
      <FwbButton v-if="filter === 'pending'" color="light" @click="filter = 'all'">Show earlier reviews</FwbButton>
    </UiEmptyState>
    <UiCardGrid v-else>
      <UiCard v-for="item in shown" :key="item.id" :to="`/approvals/${item.id}`">
        <div class="flex items-start justify-between gap-3">
          <span class="inline-flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <span class="grid size-8 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"><UiIcon :name="TYPE[item.targetType]?.icon ?? 'pages'" :size="17" /></span>
            {{ TYPE[item.targetType]?.label ?? 'Page' }}
          </span>
          <span class="sb-status" :class="stateClass(item.state)">{{ REVIEW_STATE_LABELS[item.state as ReviewState] }}</span>
        </div>
        <h2 class="mt-4 mb-0 break-words text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">{{ item.title }}</h2>
        <p class="mt-1 mb-0 line-clamp-3 text-sm text-gray-600 dark:text-gray-400">{{ item.changeSummary || 'No summary' }}</p>
        <p class="mt-auto mb-0 inline-flex items-center gap-1 pt-4 text-xs text-gray-500 dark:text-gray-400"><UiIcon name="clock" :size="13" /> {{ item.submittedByName }}, {{ timeAgo(item.createdAt) }}</p>
      </UiCard>
    </UiCardGrid>
  </div>
</template>
