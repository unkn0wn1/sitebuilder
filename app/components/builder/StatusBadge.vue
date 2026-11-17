<script setup lang="ts">
import { statusLabel, type WorkflowState } from '#shared/workflow'

const props = defineProps<{ state: WorkflowState; hasUnpublishedChanges?: boolean }>()
const label = computed(() => statusLabel(props.state, props.hasUnpublishedChanges))
const kind = computed(() => (props.state === 'published' && props.hasUnpublishedChanges ? 'published-changes' : props.state))
</script>

<template>
  <span class="sb-status" :class="`sb-status-${kind}`">{{ label }}</span>
</template>
