<script setup lang="ts">
const route = useRoute()
// The page and site-part editors use the full width; the sidebar folds to an icon rail.
const isEditor = computed(() => (/^\/pages\/[^/]+$/.test(route.path) && !['/pages/new-assistant', '/pages/bin'].includes(route.path)) || /^\/site-parts\/[^/]+$/.test(route.path))
</script>

<template>
  <BuilderAppShell :editor="isEditor">
    <slot />
  </BuilderAppShell>
</template>
