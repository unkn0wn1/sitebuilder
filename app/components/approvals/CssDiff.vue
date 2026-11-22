<script setup lang="ts">
import { computed } from 'vue'
import { diffLines } from '#shared/line-diff'

const props = defineProps<{ before: string; after: string }>()

const rows = computed(() => diffLines(props.before, props.after).flatMap((row) => (row.kind === 'add' || row.kind === 'remove' ? [{ kind: row.kind, text: row.text }] : [])))
</script>

<template>
  <div v-if="rows.length" class="mt-1 font-mono text-xs">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="whitespace-pre-wrap break-words px-2 py-0.5"
      :class="row.kind === 'add' ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100' : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'"
    >{{ row.kind === 'add' ? '+ ' : '- ' }}{{ row.text || ' ' }}</div>
  </div>
</template>
