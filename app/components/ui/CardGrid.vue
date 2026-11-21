<script setup lang="ts">
// Cards that reflow from one column on a phone to three or four on a wide screen. The page scrolls, never the grid.
defineProps<{ wide?: boolean }>()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" :class="wide ? 'xl:grid-cols-2' : 'xl:grid-cols-3 2xl:grid-cols-4'">
    <slot />
  </div>
</template>
