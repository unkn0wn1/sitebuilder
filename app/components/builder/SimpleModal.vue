<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/50 p-6" role="presentation" @click.self="emit('close')">
    <div role="dialog" aria-modal="true" class="my-8 w-full max-w-3xl rounded-lg bg-white dark:bg-gray-800 shadow-xl" @click.stop>
      <div class="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-3">
        <h2 class="m-0 text-lg font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h2>
        <button type="button" class="rounded p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close" @click="emit('close')">×</button>
      </div>
      <div class="px-5 py-4">
        <slot />
      </div>
      <div class="border-t border-gray-200 dark:border-gray-700 px-5 py-3">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
