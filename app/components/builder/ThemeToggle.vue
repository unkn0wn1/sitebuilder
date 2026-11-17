<script setup lang="ts">
import type { ThemePreference } from '../../utils/theme'

const { preference, setPreference } = useColorMode()

const options: { id: ThemePreference; label: string; title: string }[] = [
  { id: 'system', label: 'System', title: 'Use the computer’s light or dark setting' },
  { id: 'light', label: 'Light', title: 'Light appearance' },
  { id: 'dark', label: 'Dark', title: 'Dark appearance' },
]
</script>

<template>
  <div class="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-600" role="group" aria-label="Colour theme">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="rounded px-2 py-0.5 text-xs"
      :class="preference === option.id ? 'bg-gray-900 font-medium text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'"
      :aria-pressed="preference === option.id"
      :title="option.title"
      @click="setPreference(option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
