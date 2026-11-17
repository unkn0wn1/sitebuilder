<script setup lang="ts">
const props = defineProps<{
  jobState: 'queued' | 'running' | 'done' | 'failed' | string
  lastError?: string | null
  isSitePart: boolean
  viewHref: string | null
  title: string
}>()

const steps = computed(() => {
  const done = props.jobState === 'done'
  const running = props.jobState === 'running' || props.jobState === 'queued'
  const failed = props.jobState === 'failed'
  return [
    { id: 'build', label: 'Building', done: done || props.jobState === 'running' || failed },
    { id: 'live', label: 'Going live', done },
    { id: 'cache', label: props.isSitePart ? 'Updating every page' : 'Clearing cache', done },
  ]
})
</script>

<template>
  <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
    <h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{{ jobState === 'done' ? 'Live' : `Publishing ${title}` }}</h2>
    <ol class="m-0 flex list-none flex-wrap gap-4 p-0 text-sm">
      <li v-for="step in steps" :key="step.id" class="flex items-center gap-2" :class="step.done ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'">
        <span class="inline-block w-4 text-center">{{ step.done ? '✓' : '○' }}</span>
        {{ step.label }}
      </li>
    </ol>
    <p v-if="isSitePart && (jobState === 'running' || jobState === 'done')" class="mt-3 text-sm text-gray-600 dark:text-gray-400">Updating every page (about a minute).</p>
    <FwbAlert v-if="jobState === 'failed'" type="danger" class="mt-4">{{ lastError || 'Publishing failed. Try again in a moment.' }}</FwbAlert>
    <p v-if="jobState === 'done'" class="mt-4">
      <a v-if="viewHref" :href="viewHref" class="text-blue-700 dark:text-blue-400" target="_blank" rel="noreferrer">View page</a>
      <span v-else>It's live.</span>
    </p>
  </div>
</template>
