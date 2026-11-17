<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { BriefQuestion, PagePlan } from '#shared/page-brief'
import { can } from '#shared/roles'

definePageMeta({ layout: 'builder' })

interface BriefView {
  id: string
  state: 'interviewing' | 'planned' | 'built'
  prompt: string
  questionCount: number
  question?: BriefQuestion
  plan?: PagePlan
  pageId?: string | null
  templateId?: string | null
  warning?: string
}

interface AiStatus {
  enabled: boolean
  available: boolean
  reason: string
  message: string | null
}

const { user } = useSession()
const canEdit = computed(() => !!user.value && can(user.value, 'page.edit'))
const canSaveTemplate = computed(() => !!user.value && can(user.value, 'template.edit'))
const route = useRoute()

const status = ref<AiStatus | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const warning = ref('')
const prompt = ref('')
const answer = ref('')
const selectedChip = ref('')
const brief = ref<BriefView | null>(null)
const saveAsTemplate = ref(false)
const building = ref(false)

const step = computed(() => {
  if (!status.value?.available || !status.value.enabled) return 'unavailable'
  if (!brief.value) return 'prompt'
  if (brief.value.state === 'built' && brief.value.pageId) return 'built'
  if (brief.value.state === 'planned' && brief.value.plan) return 'plan'
  return 'question'
})

async function loadStatus() {
  loading.value = true
  error.value = ''
  try {
    status.value = await api<AiStatus>('/ai/status')
    const id = typeof route.query.brief === 'string' ? route.query.brief : ''
    if (id && status.value.available && status.value.enabled) {
      brief.value = await api<BriefView>(`/ai/page-briefs/${id}`)
      warning.value = brief.value.warning ?? ''
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not check the assistant just then.'
  } finally {
    loading.value = false
  }
}

async function setBrief(next: BriefView) {
  brief.value = next
  warning.value = next.warning ?? ''
  answer.value = ''
  selectedChip.value = ''
  if (route.query.brief !== next.id) {
    await navigateTo({ path: '/pages/new-assistant', query: { brief: next.id } }, { replace: true })
  }
}

async function startBrief() {
  const text = prompt.value.trim()
  if (!text) {
    error.value = 'Say what you want the page to be.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const next = await api<BriefView>('/ai/page-briefs', { method: 'POST', body: { prompt: text } })
    await setBrief(next)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'The assistant could not start just then.'
  } finally {
    busy.value = false
  }
}

function pickChip(chip: string) {
  selectedChip.value = selectedChip.value === chip ? '' : chip
}

async function submitAnswer() {
  if (!brief.value) return
  const text = answer.value.trim()
  const chip = selectedChip.value
  if (!chip && !text) {
    error.value = 'Choose a suggestion or write an answer.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const next = await api<BriefView>(`/ai/page-briefs/${brief.value.id}/answers`, {
      method: 'POST',
      body: {
        questionId: brief.value.question?.id,
        prompt: brief.value.question?.prompt,
        ...(chip ? { chip } : {}),
        ...(text ? { text } : {}),
      },
    })
    await setBrief(next)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'The assistant could not continue just then.'
  } finally {
    busy.value = false
  }
}

async function build() {
  if (!brief.value) return
  building.value = true
  error.value = ''
  try {
    const next = await api<BriefView>(`/ai/page-briefs/${brief.value.id}/build`, {
      method: 'POST',
      body: { saveAsTemplate: canSaveTemplate.value && saveAsTemplate.value },
    })
    await setBrief(next)
    if (next.pageId) await navigateTo(`/pages/${next.pageId}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'The page could not be built just then.'
  } finally {
    building.value = false
  }
}

onMounted(loadStatus)
</script>

<template>
  <div class="mx-auto max-w-3xl p-6">
    <NuxtLink to="/pages" class="text-sm text-gray-600 dark:text-gray-400 no-underline hover:underline">&lt; Pages</NuxtLink>
    <h1 class="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">New page with the assistant</h1>
    <p class="mt-2 text-gray-600 dark:text-gray-300">
      Describe what you want. The assistant will ask a few questions, show a short plan, then build a draft you can keep editing. Nothing is published.
    </p>

    <p v-if="loading" class="mt-6 text-gray-500 dark:text-gray-400">Checking the assistant…</p>

    <FwbAlert v-else-if="error" type="danger" class="mt-6">{{ error }}</FwbAlert>

    <div v-else-if="step === 'unavailable'" class="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-5">
      <p class="text-gray-800 dark:text-gray-100">{{ status?.message || "The assistant isn't available right now." }}</p>
      <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">You can still start a page yourself, without the assistant.</p>
      <FwbButton class="mt-4" @click="navigateTo('/pages')">Back to pages</FwbButton>
    </div>

    <div v-else-if="!canEdit" class="mt-6">
      <p class="text-gray-600 dark:text-gray-300">You don't have permission to create pages.</p>
    </div>

    <template v-else>
      <FwbAlert v-if="warning && !error" type="info" class="mt-6">{{ warning }}</FwbAlert>

      <form v-if="step === 'prompt'" class="mt-6 space-y-4" @submit.prevent="startBrief">
        <FwbTextarea
          v-model="prompt"
          label="What should this page be?"
          placeholder="For example: a winter blanket appeal for existing supporters, with a story and a donation form."
          :rows="6"
          required
        />
        <div class="flex flex-wrap gap-2">
          <FwbButton type="submit" :disabled="busy">{{ busy ? 'Thinking…' : 'Continue' }}</FwbButton>
          <FwbButton color="light" type="button" :disabled="busy" @click="navigateTo('/pages')">Cancel</FwbButton>
        </div>
      </form>

      <form v-else-if="step === 'question' && brief?.question" class="mt-6 space-y-4" @submit.prevent="submitAnswer">
        <p class="text-sm text-gray-500 dark:text-gray-400">Question {{ brief.questionCount + 1 }} of up to 5</p>
        <p class="text-lg font-medium text-gray-900 dark:text-gray-100">{{ brief.question.prompt }}</p>
        <div v-if="brief.question.chips.length" class="flex flex-wrap gap-2">
          <button
            v-for="chip in brief.question.chips"
            :key="chip"
            type="button"
            class="rounded-full border px-3 py-1.5 text-sm transition"
            :class="selectedChip === chip
              ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200'
              : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'"
            @click="pickChip(chip)"
          >
            {{ chip }}
          </button>
        </div>
        <FwbTextarea
          v-if="brief.question.allowFreeText"
          v-model="answer"
          label="Or write your own answer"
          :rows="3"
        />
        <div class="flex flex-wrap gap-2">
          <FwbButton type="submit" :disabled="busy">{{ busy ? 'Thinking…' : 'Continue' }}</FwbButton>
          <FwbButton color="light" type="button" :disabled="busy" @click="navigateTo('/pages')">Cancel</FwbButton>
        </div>
      </form>

      <div v-else-if="step === 'plan' && brief?.plan" class="mt-6 space-y-4">
        <h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Here's what I'll build</h2>
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-5">
          <p class="text-gray-800 dark:text-gray-100">{{ brief.plan.summary }}</p>
          <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Title</dt>
              <dd class="font-medium text-gray-900 dark:text-gray-100">{{ brief.plan.title }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Page type</dt>
              <dd class="font-medium text-gray-900 dark:text-gray-100">{{ brief.plan.template }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Used as</dt>
              <dd class="font-medium text-gray-900 dark:text-gray-100">{{ brief.plan.usage }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Tone</dt>
              <dd class="font-medium text-gray-900 dark:text-gray-100">{{ brief.plan.tone }}</dd>
            </div>
          </dl>
          <p class="mt-4 text-sm font-medium text-gray-700 dark:text-gray-200">Sections</p>
          <ol class="mt-2 list-decimal space-y-1 pl-5 text-gray-800 dark:text-gray-200">
            <li v-for="(section, i) in brief.plan.sections" :key="`${section.type}-${i}`">
              {{ section.type }}<span v-if="section.purpose"> — {{ section.purpose }}</span>
            </li>
          </ol>
        </div>
        <label v-if="canSaveTemplate" class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input v-model="saveAsTemplate" type="checkbox" class="mt-1 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800">
          <span>Also save this structure as a reusable page type (a draft, not published).</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <FwbButton :disabled="building" @click="build">{{ building ? 'Building…' : 'Build' }}</FwbButton>
          <FwbButton color="light" :disabled="building" @click="navigateTo('/pages')">Cancel</FwbButton>
        </div>
      </div>
    </template>
  </div>
</template>
