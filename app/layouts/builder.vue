<script setup lang="ts">
const route = useRoute()
const isEditor = computed(() => /^\/pages\/[^/]+$/.test(route.path) && route.path !== '/pages')
</script>

<template>
  <BuilderAppShell :editor="isEditor">
    <slot />
  </BuilderAppShell>
</template>
