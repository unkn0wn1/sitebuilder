<script setup lang="ts">
defineProps<{ title: string; note?: string }>()
</script>

<template>
  <div class="sb-page">
    <UiPageHeader :title="title" />
    <UiEmptyState icon="forms" title="Not ready yet" :description="note ?? 'This screen isn\'t ready yet. You can still add forms and embeds to pages from the page editor.'">
      <NuxtLink to="/pages" class="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white no-underline hover:bg-blue-800">
        <UiIcon name="pages" :size="16" /> Go to pages
      </NuxtLink>
    </UiEmptyState>
  </div>
</template>
