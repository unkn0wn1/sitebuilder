<script setup lang="ts">
defineProps<{ title: string; note?: string }>()
</script>

<template>
  <div class="p-8">
    <h1 class="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h1>
    <p class="max-w-xl text-gray-600 dark:text-gray-400">{{ note ?? "This screen isn't ready yet. You can still edit pages." }}</p>
  </div>
</template>
