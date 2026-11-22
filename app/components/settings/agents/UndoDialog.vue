<script setup lang="ts">
import { api, ApiError } from '../../../utils/api'
import SimpleModal from '../../builder/SimpleModal.vue'

const props = defineProps<{ changeId: string; title: string }>()
const emit = defineEmits<{ close: []; done: [message: string] }>()

const reason = ref('')
const busy = ref(false)
const error = ref('')

async function undo() {
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ pagesTakenOffline?: string[] }>(`/agent/changes/${props.changeId}/undo`, { method: 'POST', body: { reason: reason.value.trim() } })
    const offline = r.pagesTakenOffline?.length ? ` ${r.pagesTakenOffline.length === 1 ? 'The new page' : `The ${r.pagesTakenOffline.length} new pages`} (${r.pagesTakenOffline.join(', ')}) ${r.pagesTakenOffline.length === 1 ? 'is' : 'are'} being taken offline.` : ''
    emit('done', `Undone: "${props.title}". The earlier version is going live now.${offline}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not undo that change.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SimpleModal title="Undo this change" @close="emit('close')">
    <form id="undo-form" class="space-y-4" @submit.prevent="undo">
      <p class="m-0 text-sm text-gray-700 dark:text-gray-300">This puts back what the pages said before <strong>{{ title }}</strong> and publishes that straight away. Pages the change created are taken offline (they stay in Pages as drafts). It is refused if someone has published the same pages since.</p>
      <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
      <FwbInput v-model="reason" label="Why are you undoing it? (saved in the activity log)" placeholder="Wrong phone number" />
    </form>
    <template #footer>
      <div class="flex gap-2">
        <FwbButton type="submit" form="undo-form" color="red" :disabled="busy || reason.trim().length < 5">{{ busy ? 'Undoing…' : 'Undo and publish' }}</FwbButton>
        <FwbButton color="light" type="button" @click="emit('close')">Cancel</FwbButton>
      </div>
    </template>
  </SimpleModal>
</template>
