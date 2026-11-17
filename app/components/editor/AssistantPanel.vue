<script setup lang="ts">
import type { useAssistant } from '../../composables/useAssistant'

const props = defineProps<{ assistant: ReturnType<typeof useAssistant> }>()

const stateCopy: Record<string, string> = {
  ready: '',
  thinking: 'Thinking…',
  working: 'Working through the steps…',
  checking: 'Checking it on a phone and a computer…',
  needs_you: 'I need a bit of help from you.',
  done: '',
  stopped: "Stopped. Here's what I'd done so far.",
  limit: "That's as far as I can go in one go.",
  monthly: "This month's assistant budget is used up. You can still edit by hand.",
  unavailable: "The assistant isn't available right now. Everything else works as normal.",
  off: "The assistant isn't switched on yet. You can still edit the page yourself.",
}

const state = computed(() => props.assistant.state.value)
const available = computed(() => props.assistant.available.value)
const lines = computed(() => props.assistant.lines.value)
const needsYou = computed(() => props.assistant.needsYou.value)
const error = computed(() => props.assistant.error.value)
const draft = computed({
  get: () => props.assistant.draft.value,
  set: (value: string) => {
    props.assistant.draft.value = value
  },
})
const busy = computed(() => ['thinking', 'working', 'checking'].includes(state.value))
const statusText = computed(() => (state.value !== 'ready' ? stateCopy[state.value] : ''))

function onSubmit() {
  void props.assistant.send(draft.value)
}

function needsLabel(value: unknown): string {
  const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (rec.needsYou === 'upload') return String(rec.message || rec.purpose || 'Please upload a photo.')
  if (rec.needsYou === 'approve_crop') return 'Please approve this crop before I use it.'
  return 'I need a decision from you before I can go on.'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <p v-if="statusText" class="mb-3 text-sm text-gray-700">{{ statusText }}</p>
    <p v-else-if="!lines.length" class="mb-3 text-sm text-gray-600">{{ props.assistant.greeting }}</p>

    <div v-if="!lines.length && available" class="mb-4">
      <p class="mb-2 text-sm font-medium text-gray-800">Suggested prompts</p>
      <ul class="m-0 list-none space-y-2 p-0">
        <li v-for="item in props.assistant.suggestions" :key="item">
          <button type="button" class="w-full rounded-md bg-gray-50 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100" :disabled="busy" @click="props.assistant.send(item)">
            {{ item }}
          </button>
        </li>
      </ul>
    </div>

    <ol class="m-0 min-h-0 flex-1 list-none space-y-2 overflow-y-auto p-0">
      <li v-for="line in lines" :key="line.id" class="rounded-md px-3 py-2 text-sm" :class="line.role === 'user' ? 'bg-blue-50 text-blue-950' : line.role === 'tool' ? 'bg-gray-50 text-gray-600' : 'bg-white text-gray-800'">
        {{ line.text }}
      </li>
    </ol>

    <div v-if="needsYou" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      {{ needsLabel(needsYou.result) }}
    </div>
    <p v-if="error" class="mt-3 text-sm text-red-700">{{ error }}</p>

    <form class="mt-3" @submit.prevent="onSubmit">
      <FwbTextarea v-model="draft" placeholder="Ask the assistant…" :disabled="!available || busy" />
      <div class="mt-2 flex justify-end gap-2">
        <FwbButton v-if="busy" size="sm" color="light" type="button" @click="props.assistant.stop()">Stop</FwbButton>
        <FwbButton size="sm" type="submit" :disabled="!available || busy || !draft.trim()">Send</FwbButton>
      </div>
    </form>
  </div>
</template>
