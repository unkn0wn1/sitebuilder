<script setup lang="ts">
import type { FieldIssue } from '#shared/issues'
import { issuesAt, issuesUnder } from '#shared/field-issues'

const props = withDefaults(
  defineProps<{
    issues?: FieldIssue[]
    path: string
    /** When true, also show issues on children that are not given their own FieldErrors. */
    includeChildren?: boolean
  }>(),
  { issues: () => [], includeChildren: false },
)

const messages = computed(() => {
  const list = props.includeChildren ? issuesUnder(props.issues, props.path) : issuesAt(props.issues, props.path)
  return [...new Set(list.map((issue) => issue.message))]
})
</script>

<template>
  <ul v-if="messages.length" class="mt-1 list-disc space-y-1 pl-4 text-sm text-red-800 dark:text-red-200" :data-field-path="path">
    <li v-for="(message, i) in messages" :key="i">{{ message }}</li>
  </ul>
</template>
