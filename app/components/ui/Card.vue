<script setup lang="ts">
// The builder's surface (`flush` drops the padding): white, a hairline border, a soft shadow and 12px corners. With `to`, the whole card is a link.
const props = defineProps<{ title?: string; description?: string; to?: string; flush?: boolean; tone?: 'default' | 'muted' | 'accent' }>()
const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : 'div'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    class="group relative flex min-w-0 flex-col rounded-xl border text-left no-underline shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition"
    :class="[
      tone === 'muted' ? 'border-dashed border-gray-300 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40' : tone === 'accent' ? 'border-blue-200 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/10' : 'border-gray-200/90 bg-white dark:border-gray-800 dark:bg-gray-900',
      to ? 'hover:-translate-y-px hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:border-gray-700' : '',
      flush ? '' : 'p-5',
    ]"
  >
    <div v-if="title || $slots.actions" class="mb-3 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 v-if="title" class="m-0 text-base font-semibold text-gray-900 dark:text-white">{{ title }}</h2>
        <p v-if="description" class="mt-0.5 mb-0 text-sm text-gray-600 dark:text-gray-400">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
    </div>
    <slot />
  </component>
</template>
