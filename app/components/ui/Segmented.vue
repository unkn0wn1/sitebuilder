<script setup lang="ts" generic="T extends string">
import type { IconName } from './Icon.vue'
// A small segmented control (devices, light or dark). Icons with hidden labels on narrow screens.
defineProps<{ modelValue: T; options: { value: T; label: string; icon?: IconName }[]; label: string; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [T] }>()
</script>

<template>
  <div class="inline-flex shrink-0 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition"
      :class="modelValue === o.value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'"
      :aria-pressed="modelValue === o.value"
      :title="o.label"
      @click="emit('update:modelValue', o.value)"
    >
      <UiIcon v-if="o.icon" :name="o.icon" :size="15" />
      <span :class="o.icon && compact ? 'sr-only' : o.icon ? 'hidden sm:inline' : ''">{{ o.label }}</span>
    </button>
  </div>
</template>
