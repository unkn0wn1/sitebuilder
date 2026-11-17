<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { canSubmit, statusLabel, type WorkflowState } from '#shared/workflow'
import { can } from '#shared/roles'
import type { TemplateRules } from '#shared/templates'
import { blockCatalog, blockLabel } from '../../utils/block-fields'

definePageMeta({ layout: 'builder' })

interface TemplateRow {
  id: string
  key: string
  label: string
  workflowState: WorkflowState
  draftVersionId: string | null
  publishedVersionId: string | null
}

const route = useRoute()
const id = computed(() => String(route.params.id))
const { user } = useSession()
const canEdit = computed(() => user.value && can(user.value, 'template.edit'))
const catalog = blockCatalog()
const grouped = computed(() => {
  const map = new Map<string, typeof catalog>()
  for (const block of catalog) {
    const list = map.get(block.category) ?? []
    list.push(block)
    map.set(block.category, list)
  }
  return [...map.entries()]
})

const loading = ref(true)
const error = ref('')
const saved = ref('')
const pack = ref<TemplateRow | null>(null)
const doc = ref<TemplateRules | null>(null)
const revision = ref(0)
const review = ref<{ id: string } | null>(null)
const saveStatus = ref<'saved' | 'saving' | 'error' | ''>('')
const submitting = ref(false)
const showSubmit = ref(false)
const submitNote = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
let pending = false

const edited = ref(false)
const hasChanges = computed(() => edited.value || (!!pack.value && pack.value.draftVersionId !== pack.value.publishedVersionId))
const canSubmitNow = computed(() => canEdit.value && pack.value && canSubmit(pack.value.workflowState) && hasChanges.value && saveStatus.value !== 'saving')

function sampleProps(type: string): Record<string, unknown> {
  return { ...(catalog.find((block) => block.type === type)?.sample ?? {}) }
}

function queueSave() {
  if (!canEdit.value) return
  pending = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void save() }, 400)
}

function isAllowed(type: string) {
  return !!doc.value?.allowedBlocks.includes(type)
}

function isRequired(type: string) {
  return !!doc.value?.requiredBlocks.includes(type)
}

function toggleAllowed(type: string, on: boolean) {
  if (!doc.value) return
  const allowed = new Set(doc.value.allowedBlocks)
  if (on) allowed.add(type)
  else {
    allowed.delete(type)
    doc.value.requiredBlocks = doc.value.requiredBlocks.filter((item) => item !== type)
    if (type === 'Hero' || type === 'VideoHero') {
      if (!allowed.has('Hero') && !allowed.has('VideoHero')) {
        doc.value.requiredBlocks = doc.value.requiredBlocks.filter((item) => item !== 'Hero')
      }
    }
    doc.value.startingBlocks = doc.value.startingBlocks.filter((item) => item.type !== type)
  }
  doc.value.allowedBlocks = catalog.map((block) => block.type).filter((item) => allowed.has(item))
  if (!doc.value.allowedBlocks.length && !on) {
    // keep at least the last one if they uncheck everything — the API will also reject it
  }
  queueSave()
}

function toggleRequired(type: string, on: boolean) {
  if (!doc.value) return
  const required = type === 'VideoHero' ? 'Hero' : type
  const set = new Set(doc.value.requiredBlocks)
  if (on) {
    if (!isAllowed(type) && !(required === 'Hero' && (isAllowed('Hero') || isAllowed('VideoHero')))) return
    set.add(required)
  } else set.delete(required)
  doc.value.requiredBlocks = [...set]
  queueSave()
}

function addStarting(type: string) {
  if (!doc.value || !type || type === '__add__' || !isAllowed(type)) return
  doc.value.startingBlocks = [...doc.value.startingBlocks, { type, props: sampleProps(type) }]
  queueSave()
}

function moveStarting(index: number, dir: -1 | 1) {
  if (!doc.value) return
  const next = index + dir
  if (next < 0 || next >= doc.value.startingBlocks.length) return
  const copy = [...doc.value.startingBlocks]
  const [row] = copy.splice(index, 1)
  copy.splice(next, 0, row!)
  doc.value.startingBlocks = copy
  queueSave()
}

function removeStarting(index: number) {
  if (!doc.value) return
  doc.value.startingBlocks = doc.value.startingBlocks.filter((_, i) => i !== index)
  queueSave()
}

const addStartingType = ref('__add__')
const startingOptions = computed(() => {
  const allowed = doc.value?.allowedBlocks ?? []
  return [{ name: 'Add a starting section', value: '__add__' }, ...catalog.filter((block) => allowed.includes(block.type)).map((block) => ({ name: block.label, value: block.type }))]
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ template: TemplateRow; doc: TemplateRules; revision: number; review: { id: string } | null }>(`/templates/${id.value}`)
    pack.value = data.template
    doc.value = data.doc
    revision.value = data.revision
    review.value = data.review
    edited.value = data.template.draftVersionId !== data.template.publishedVersionId
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load this page type.'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!doc.value || !canEdit.value || !pending) return
  pending = false
  saveStatus.value = 'saving'
  error.value = ''
  try {
    const result = await api<{ revision: number; doc: TemplateRules; reviewWithdrawn?: boolean }>(`/templates/${id.value}/ops`, {
      method: 'POST',
      body: { baseRevision: revision.value, ops: [{ op: 'replace', doc: doc.value }] },
    })
    revision.value = result.revision
    doc.value = result.doc
    edited.value = true
    if (pack.value) {
      pack.value.label = result.doc.label
      if (result.reviewWithdrawn) {
        pack.value.workflowState = pack.value.publishedVersionId ? 'published' : 'draft'
        review.value = null
      }
    }
    saveStatus.value = 'saved'
  } catch (err) {
    saveStatus.value = 'error'
    error.value = err instanceof ApiError ? err.message : 'Could not save this page type.'
    if (err instanceof ApiError && err.code === 'conflict') await load()
  }
}

async function onSubmit() {
  submitting.value = true
  error.value = ''
  saved.value = ''
  try {
    if (pending) await save()
    await api(`/templates/${id.value}/submit`, { method: 'POST', body: submitNote.value.trim() ? { note: submitNote.value.trim() } : {} })
    showSubmit.value = false
    submitNote.value = ''
    saved.value = 'Submitted for approval.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not submit this for approval.'
  } finally {
    submitting.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="p-6">
    <p class="mb-1 text-sm text-gray-500"><NuxtLink to="/templates" class="text-gray-500 no-underline hover:underline">Page types</NuxtLink></p>
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="m-0 text-2xl font-semibold text-gray-900">{{ pack?.label ?? 'Page type' }}</h1>
        <p v-if="pack" class="mt-1 mb-0 text-sm text-gray-600">Key: {{ pack.key }} · {{ statusLabel(pack.workflowState, hasChanges) }}<span v-if="saveStatus === 'saving'"> · Saving…</span><span v-else-if="saveStatus === 'saved'"> · Saved</span></p>
      </div>
      <FwbButton v-if="canSubmitNow" size="sm" :disabled="submitting" @click="showSubmit = true">Submit for approval</FwbButton>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>
    <p v-if="review && pack?.workflowState === 'in_review'" class="mb-4 text-sm text-gray-700">This is waiting for approval. Editing it will withdraw the review so it can be submitted again. <NuxtLink :to="`/approvals/${review.id}`">Open the review</NuxtLink>.</p>
    <p v-if="loading" class="text-gray-500">Loading…</p>
    <form v-else-if="doc" class="max-w-3xl space-y-8" @submit.prevent>
      <div class="max-w-md">
        <FwbInput v-model="doc.label" label="Name" :disabled="!canEdit" @update:model-value="queueSave" />
      </div>
      <section>
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Allowed and required sections</h2>
        <p class="mb-4 text-sm text-gray-600">Allowed sections can be added to a page of this type. Required sections must be present before the page can be submitted. A required Hero can also be a video hero.</p>
        <div v-for="[category, blocks] in grouped" :key="category" class="mb-5">
          <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{{ category }}</h3>
          <div class="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            <div v-for="block in blocks" :key="block.type" class="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <span class="text-sm text-gray-900">{{ block.label }}</span>
              <div class="flex items-center gap-4 text-sm text-gray-700">
                <label class="flex items-center gap-1.5">
                  <input type="checkbox" class="rounded border-gray-300" :checked="isAllowed(block.type)" :disabled="!canEdit" @change="toggleAllowed(block.type, ($event.target as HTMLInputElement).checked)" />
                  Allowed
                </label>
                <label v-if="block.type !== 'VideoHero'" class="flex items-center gap-1.5">
                  <input type="checkbox" class="rounded border-gray-300" :checked="isRequired(block.type)" :disabled="!canEdit || !isAllowed(block.type)" @change="toggleRequired(block.type, ($event.target as HTMLInputElement).checked)" />
                  Required
                </label>
                <span v-else class="text-xs text-gray-500">Counts as a Hero if Hero is required</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section>
        <h2 class="mb-1 text-lg font-semibold text-gray-900">Starting sections</h2>
        <p class="mb-4 text-sm text-gray-600">A new page of this type begins with these sections, in this order. Editors can still add or remove sections afterwards, within the rules above.</p>
        <p v-if="!doc.startingBlocks.length" class="text-sm text-gray-500">New pages will start empty.</p>
        <ul v-else class="mb-4 list-none space-y-2 p-0">
          <li v-for="(item, index) in doc.startingBlocks" :key="`${item.type}-${index}`" class="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
            <span class="flex-1 text-sm text-gray-900">{{ blockLabel(item.type) }}</span>
            <FwbButton color="light" size="sm" :disabled="!canEdit || index === 0" @click="moveStarting(index, -1)">Up</FwbButton>
            <FwbButton color="light" size="sm" :disabled="!canEdit || index === doc.startingBlocks.length - 1" @click="moveStarting(index, 1)">Down</FwbButton>
            <FwbButton color="light" size="sm" :disabled="!canEdit" @click="removeStarting(index)">Remove</FwbButton>
          </li>
        </ul>
        <div v-if="canEdit" class="max-w-sm">
          <FwbSelect :model-value="addStartingType" :options="startingOptions" @update:model-value="addStarting(String($event)); addStartingType = '__add__'" />
        </div>
      </section>
    </form>
    <div v-if="showSubmit" class="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h2 class="mt-0 mb-2 text-lg font-semibold">Submit for approval</h2>
        <p class="mb-4 text-sm text-gray-600">These rules will apply to pages of this type after an approver publishes them. Existing live pages are not re-rendered.</p>
        <FwbInput v-model="submitNote" label="Note for the approver (optional)" />
        <div class="mt-4 flex justify-end gap-2">
          <FwbButton color="light" :disabled="submitting" @click="showSubmit = false">Cancel</FwbButton>
          <FwbButton :disabled="submitting" @click="onSubmit">{{ submitting ? 'Submitting…' : 'Submit' }}</FwbButton>
        </div>
      </div>
    </div>
  </div>
</template>
