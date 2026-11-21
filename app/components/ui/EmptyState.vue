<script setup lang="ts">
import type { IconName } from './Icon.vue'
// What goes here, and the one action that starts it.
defineProps<{ icon?: IconName; title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center rounded-xl border border-dashed border-gray-300 bg-white/60 px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-900/40">
    <span class="mb-3 grid size-11 place-items-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
      <UiIcon :name="icon ?? 'inbox'" :size="22" />
    </span>
    <p class="m-0 text-base font-semibold text-gray-900 dark:text-white">{{ title }}</p>
    <p v-if="description" class="mt-1 mb-0 max-w-md text-sm text-gray-600 dark:text-gray-400">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
