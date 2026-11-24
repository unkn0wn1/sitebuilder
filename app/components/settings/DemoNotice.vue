<script setup lang="ts">
const { status, load } = useDemoStatus()
onMounted(() => {
  void load()
})
</script>

<template>
  <p v-if="status?.demo" class="mb-4 max-w-2xl rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
    This part of Settings is read-only on the public demo. Changes to secrets, hostnames, users, integrations, mail, AI keys, backups, and operator settings are turned off.
  </p>
</template>
