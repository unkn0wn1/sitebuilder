<script setup lang="ts">
import { h } from 'vue'
import { richTextVNodes } from '../../utils/rich-text-view'
import type { RichTextDoc } from '#shared/richtext'

const props = defineProps<{ doc?: RichTextDoc | unknown }>()
const view = computed(() => h('div', { class: 'prose' }, richTextVNodes(props.doc)))
</script>

<template>
  <component :is="view" />
</template>
