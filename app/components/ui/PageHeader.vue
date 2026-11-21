<script setup lang="ts">
// The top of every list and settings screen: title, one line of help, and the actions on the right.
defineProps<{ title: string; description?: string; back?: { to: string; label: string } }>()
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <div class="min-w-0">
      <NuxtLink v-if="back" :to="back.to" class="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 no-underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
        <UiIcon name="back" :size="14" /> {{ back.label }}
      </NuxtLink>
      <h1 class="m-0 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{{ title }}</h1>
      <p v-if="description" class="mt-1 mb-0 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{{ description }}</p>
      <slot name="meta" />
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </div>
</template>
