<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { diffLines, type LineDiffRow } from '#shared/line-diff'

interface SoulView {
  text: string
  defaultText: string
  strippedLength: number
  limit: number
  rawLimit: number
  isDefault: boolean
}

interface Proposal {
  id: string
  agentLabel: string
  reason: string
  text?: string
  strippedLength: number
  limit: number
  stale: boolean
  status: string
  createdAt: string
}

interface ProposalList {
  proposals: Proposal[]
  currentHash: string | null
  currentText: string
}

const props = defineProps<{ draft: string; saved: string }>()
const emit = defineEmits<{ applied: [view: SoulView] }>()

const STALE = 'The personality changed after this was proposed. The diff below is against the current text.'

const proposals = ref<Proposal[]>([])
const currentHash = ref<string | null>(null)
const currentText = ref('')
const loadError = ref('')
const actionError = ref('')
const notes = ref<Record<string, string>>({})
const confirmed = ref(new Set<string>())
const openGaps = ref(new Set<string>())
const busy = ref('')
const busyAction = ref<'approve' | 'reject' | ''>('')

const pending = computed(() => proposals.value.filter((proposal) => proposal.status === 'pending' && typeof proposal.text === 'string'))
const dirty = computed(() => props.draft !== props.saved)

function when(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function seen(proposal: Proposal) {
  return `${proposal.strippedLength.toLocaleString('en-GB')} of ${proposal.limit.toLocaleString('en-GB')} characters the AI sees (comments not counted)`
}

function rowsFor(proposal: Proposal): LineDiffRow[] {
  return diffLines(currentText.value, proposal.text ?? '')
}

function approveLabel(proposal: Proposal) {
  if (busy.value === proposal.id && busyAction.value === 'approve') return 'Approving…'
  if (proposal.stale) return 'Approve and replace current text'
  if (confirmed.value.has(proposal.id)) return 'Approve anyway'
  return 'Approve'
}

function rejectLabel(proposal: Proposal) {
  return busy.value === proposal.id && busyAction.value === 'reject' ? 'Rejecting…' : 'Reject'
}

function gapKey(id: string, index: number) {
  return `${id}:${index}`
}

function toggleGap(key: string) {
  const next = new Set(openGaps.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openGaps.value = next
}

async function load(keepActionError = false) {
  loadError.value = ''
  if (!keepActionError) actionError.value = ''
  try {
    const list = await api<ProposalList>('/settings/soul/proposals')
    proposals.value = list.proposals
    currentHash.value = list.currentHash
    currentText.value = list.currentText
    const ids = new Set(list.proposals.map((proposal) => proposal.id))
    confirmed.value = new Set([...confirmed.value].filter((id) => ids.has(id)))
    for (const proposal of list.proposals) if (notes.value[proposal.id] === undefined) notes.value[proposal.id] = ''
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not load personality proposals.'
  }
}

async function approve(proposal: Proposal) {
  if (dirty.value && !confirmed.value.has(proposal.id)) {
    confirmed.value = new Set(confirmed.value).add(proposal.id)
    return
  }
  busy.value = proposal.id
  busyAction.value = 'approve'
  actionError.value = ''
  try {
    const body = proposal.stale ? { overwrite: true, currentHash: currentHash.value } : {}
    const saved = await api<SoulView>(`/settings/soul/proposals/${proposal.id}/approve`, { method: 'POST', body })
    confirmed.value = new Set()
    emit('applied', saved)
    await load()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Could not approve the proposal.'
    if (err instanceof ApiError && err.status === 409) await load(true)
  } finally {
    busy.value = ''
    busyAction.value = ''
  }
}

async function reject(proposal: Proposal) {
  busy.value = proposal.id
  busyAction.value = 'reject'
  actionError.value = ''
  try {
    const note = notes.value[proposal.id]?.trim()
    await api(`/settings/soul/proposals/${proposal.id}/reject`, { method: 'POST', body: note ? { note } : {} })
    notes.value = { ...notes.value, [proposal.id]: '' }
    await load()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Could not reject the proposal.'
  } finally {
    busy.value = ''
    busyAction.value = ''
  }
}

watch(
  () => props.draft === props.saved,
  (clean) => {
    if (clean) confirmed.value = new Set()
  },
)
onMounted(load)
defineExpose({ load })
</script>

<template>
  <FwbAlert v-if="loadError" type="danger" class="mb-4 max-w-3xl">{{ loadError }}</FwbAlert>
  <FwbAlert v-if="actionError" type="danger" class="mb-4 max-w-3xl">{{ actionError }}</FwbAlert>
  <section v-if="pending.length" aria-label="Personality proposals" class="mb-6 max-w-3xl">
    <article v-for="proposal in pending" :key="proposal.id" class="mb-4 rounded-lg border border-gray-200 p-4 last:mb-0 dark:border-gray-700">
      <h2 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">Proposed by {{ proposal.agentLabel }}</h2>
      <p class="mt-1 mb-2 text-sm text-gray-600 dark:text-gray-400">{{ when(proposal.createdAt) }}</p>
      <p class="mb-2 text-sm text-gray-900 dark:text-gray-100">{{ proposal.reason }}</p>
      <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">{{ seen(proposal) }}</p>
      <FwbAlert v-if="proposal.stale" type="warning" class="mb-3">{{ STALE }}</FwbAlert>
      <div class="mb-3 font-mono text-sm">
        <template v-for="(row, index) in rowsFor(proposal)" :key="`${proposal.id}-${index}`">
          <div v-if="row.kind === 'gap'">
            <button type="button" class="block py-1 text-left text-gray-600 underline dark:text-gray-400" @click="toggleGap(gapKey(proposal.id, index))">
              {{ openGaps.has(gapKey(proposal.id, index)) ? `Hide ${row.count} unchanged lines` : `${row.count} unchanged lines` }}
            </button>
            <template v-if="openGaps.has(gapKey(proposal.id, index))">
              <div v-for="(line, lineIndex) in row.lines" :key="lineIndex" class="whitespace-pre-wrap break-words px-2 py-0.5 text-gray-600 dark:text-gray-400">{{ line || ' ' }}</div>
            </template>
          </div>
          <div
            v-else
            class="whitespace-pre-wrap break-words px-2 py-0.5"
            :class="row.kind === 'add' ? 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100' : row.kind === 'remove' ? 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100' : 'text-gray-600 dark:text-gray-400'"
          >{{ row.text || ' ' }}</div>
        </template>
      </div>
      <FwbAlert v-if="dirty && confirmed.has(proposal.id)" type="warning" class="mb-3">You have unsaved edits in the personality box. They will be replaced if you approve this proposal.</FwbAlert>
      <div class="flex flex-wrap items-center gap-2">
        <FwbButton type="button" size="sm" :disabled="busy !== ''" @click="approve(proposal)">{{ approveLabel(proposal) }}</FwbButton>
        <label class="sr-only" :for="`soul-note-${proposal.id}`">Note</label>
        <input
          :id="`soul-note-${proposal.id}`"
          v-model="notes[proposal.id]"
          type="text"
          maxlength="500"
          placeholder="Note, optional"
          class="min-w-48 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <FwbButton type="button" size="sm" color="light" :disabled="busy !== ''" @click="reject(proposal)">{{ rejectLabel(proposal) }}</FwbButton>
      </div>
    </article>
  </section>
</template>
