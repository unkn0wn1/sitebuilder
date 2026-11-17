<script setup lang="ts">
import type { PageEditor } from '../../utils/page-editor'

defineProps<{ editor: PageEditor }>()
</script>

<template>
  <div class="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p class="mb-2">{{ editor.conflict?.message ?? 'Someone else changed this a moment ago.' }}</p>
    <div class="flex gap-2">
      <FwbButton size="sm" @click="editor.keepMine()">Keep mine</FwbButton>
      <FwbButton size="sm" color="light" @click="editor.useTheirs()">Use theirs</FwbButton>
    </div>
  </div>
</template>
