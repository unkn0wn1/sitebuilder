<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { can } from '#shared/roles'
import { defaultBrandDoc, type BrandDoc, type BrandTokens } from '#shared/brand'
import { logoPillColour, themeCssFromTokens } from '#shared/theme-css'
import { scopeThemeCss } from '../../utils/theme-css'
import { mediaFileUrl, type MediaItem } from '../../utils/media'
import { statusLabel, type WorkflowState } from '#shared/workflow'
import type { FieldIssue } from '#shared/issues'
import MediaPickerModal from '../../components/media/MediaPickerModal.vue'
import { cloneDraft } from '#shared/clone'

definePageMeta({ layout: 'builder' })

const { user } = useSession()
const canEdit = computed(() => !!user.value && can(user.value, 'brand.edit'))

const pack = ref<{ id: string; workflowState: WorkflowState; publishedVersionId: string | null; draftVersionId: string | null } | null>(null)
const doc = ref<BrandDoc>(defaultBrandDoc())
const revision = ref(0)
const warnings = ref<FieldIssue[]>([])
const saveStatus = ref<'saved' | 'saving' | 'error'>('saved')
const error = ref('')
const loading = ref(true)
const submitting = ref(false)
const showSubmit = ref(false)
const submitNote = ref('')
const showLogo = ref(false)
const logoPreview = ref<string | null>(null)
const showLogoDark = ref(false)
const logoDarkPreview = ref<string | null>(null)
const review = ref<{ id: string } | null>(null)
const withdrawnNotice = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
let lastSaved = ''
let dirty = false

type ColourToken = Exclude<keyof BrandTokens, 'logoPill'>

const TOKEN_FIELDS: { key: ColourToken; label: string }[] = [
  { key: 'ink', label: 'Body text' },
  { key: 'paper', label: 'Page background' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentInk', label: 'Text on accent' },
  { key: 'line', label: 'Lines' },
  { key: 'band', label: 'Bands' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'celebrate', label: 'Celebrate' },
  { key: 'highlight', label: 'Highlight colour' },
]

const hasUnpublishedChanges = computed(() => {
  const p = pack.value
  return !!p && p.draftVersionId !== p.publishedVersionId
})

const canSubmitNow = computed(() => {
  const p = pack.value
  if (!p || !canEdit.value) return false
  if (p.workflowState !== 'draft' && p.workflowState !== 'published' && p.workflowState !== 'unpublished') return false
  return hasUnpublishedChanges.value
})

const previewCss = computed(() => scopeThemeCss(themeCssFromTokens(doc.value.tokens, doc.value.fonts), '.sb-brand-preview'))
const logoPillPicker = computed(() => {
  const colour = logoPillColour(doc.value.tokens.logoPill)
  if (!colour) return '#ffffff'
  if (colour.length === 4) return `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`
  return colour
})
const status = computed(() => (pack.value ? statusLabel(pack.value.workflowState, hasUnpublishedChanges.value) : 'Draft'))
const statusClass = computed(() => {
  const state = pack.value?.workflowState
  if (state === 'in_review' || state === 'approved') return 'sb-status-in_review'
  if (state === 'published' && !hasUnpublishedChanges.value) return 'sb-status-published'
  return 'sb-status-draft'
})

function snapshot(value: BrandDoc) {
  return JSON.stringify(cloneDraft(value))
}

function markClean(value: BrandDoc) {
  lastSaved = snapshot(value)
  dirty = false
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ pack: { id: string; workflowState: WorkflowState; publishedVersionId: string | null; draftVersionId: string | null }; doc: BrandDoc; revision: number; review: { id: string } | null; checks: { warnings: FieldIssue[] } }>('/brand')
    pack.value = data.pack
    doc.value = data.doc
    revision.value = data.revision
    review.value = data.review
    warnings.value = data.checks.warnings
    markClean(data.doc)
    if (data.doc.logoMediaId) await loadLogo(data.doc.logoMediaId)
    else logoPreview.value = null
    if (data.doc.logoDarkMediaId) await loadLogoDark(data.doc.logoDarkMediaId)
    else logoDarkPreview.value = null
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the brand pack.'
  } finally {
    loading.value = false
  }
}

async function previewFor(id: string): Promise<string | null> {
  try {
    const item = await api<MediaItem & { preview?: string | null; renditions?: string[] }>(`/media/${id}`)
    const name = item.preview ?? item.renditions?.find((n) => n.endsWith('.svg') || n.endsWith('.webp')) ?? item.renditions?.[0]
    return name ? mediaFileUrl(id, name) : null
  } catch {
    return null
  }
}

async function loadLogo(id: string) {
  logoPreview.value = await previewFor(id)
}

async function loadLogoDark(id: string) {
  logoDarkPreview.value = await previewFor(id)
}

function scheduleSave() {
  if (!canEdit.value) return
  dirty = true
  saveStatus.value = 'saving'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), 600)
}

async function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!canEdit.value) {
    if (saveStatus.value === 'saving') saveStatus.value = 'saved'
    return
  }
  if (!dirty && snapshot(doc.value) === lastSaved) {
    if (saveStatus.value === 'saving') saveStatus.value = 'saved'
    return
  }
  saveStatus.value = 'saving'
  error.value = ''
  try {
    const result = await api<{ revision: number; doc: BrandDoc; warnings: FieldIssue[]; reviewWithdrawn?: boolean }>('/brand/ops', {
      method: 'POST',
      body: { baseRevision: revision.value, ops: [{ op: 'replace', doc: cloneDraft(doc.value) }] },
    })
    revision.value = result.revision
    warnings.value = result.warnings ?? []
    markClean(doc.value)
    saveStatus.value = 'saved'
    // Reload pack pointers so Submit knows there are changes, and so a
    // withdrawn review is reflected before we leave the page.
    const fresh = await api<{ pack: typeof pack.value; review: { id: string } | null; checks: { warnings: FieldIssue[] } }>('/brand')
    pack.value = fresh.pack
    review.value = fresh.review
    warnings.value = fresh.checks?.warnings ?? warnings.value
    if (result.reviewWithdrawn) {
      withdrawnNotice.value = 'The approval was withdrawn because the draft changed. Submit it again when you are ready.'
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not save the brand pack.'
    saveStatus.value = 'error'
  }
}

function patch(update: Partial<BrandDoc>) {
  doc.value = { ...doc.value, ...update }
  scheduleSave()
}

function setToken(key: ColourToken, value: string) {
  doc.value = { ...doc.value, tokens: { ...doc.value.tokens, [key]: value } }
  scheduleSave()
}

function setLogoPill(value: string) {
  const trimmed = value.trim()
  const white = !trimmed || /^#f{3}$|^#f{6}$/i.test(trimmed)
  const tokens = { ...doc.value.tokens }
  if (white) delete tokens.logoPill
  else tokens.logoPill = trimmed
  const next = { ...doc.value, tokens }
  if (snapshot(next) === snapshot(doc.value)) return
  doc.value = next
  scheduleSave()
}

function onLogo(item: MediaItem) {
  showLogo.value = false
  patch({ logoMediaId: item.id })
  void loadLogo(item.id)

}

function onLogoDark(item: MediaItem) {
  showLogoDark.value = false
  patch({ logoDarkMediaId: item.id })
  void loadLogoDark(item.id)
}

async function onSubmit() {
  await flush()
  if (saveStatus.value === 'error') return
  submitting.value = true
  error.value = ''
  withdrawnNotice.value = ''
  try {
    await api('/brand/submit', { method: 'POST', body: submitNote.value.trim() ? { note: submitNote.value.trim() } : {} })
    showSubmit.value = false
    submitNote.value = ''
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
  // A flush of an unchanged draft used to withdraw a just-submitted review
  // as soon as the admin left the page for Approvals.
  if (dirty) void flush()
})
</script>

<template>
  <div class="sb-page">
    <UiPageHeader title="Brand and Design" description="Colours, type and logos for the whole site. The menu look is set on the Header.">
      <span class="sb-status" data-testid="brand-status" :class="statusClass">{{ status }}</span>
      <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="save-status">{{ saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : 'Saved' }}</span>
      <FwbButton v-if="canSubmitNow" :disabled="submitting || saveStatus === 'saving'" @click="showSubmit = true">Submit for approval</FwbButton>
    </UiPageHeader>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="withdrawnNotice" type="warning" class="mb-4">{{ withdrawnNotice }}</FwbAlert>
    <p v-if="!loading && pack?.workflowState === 'in_review' && review" class="mb-4 text-sm text-gray-700 dark:text-gray-300">
      These changes are waiting for approval.
      <NuxtLink :to="`/approvals/${review.id}`" class="text-blue-700 no-underline hover:underline dark:text-blue-400">Open the review</NuxtLink>.
    </p>
    <p v-else-if="!loading && pack?.workflowState === 'approved'" class="mb-4 text-sm text-gray-700 dark:text-gray-300">Publishing. Every live page is being updated.</p>
    <p v-else-if="!loading && hasUnpublishedChanges" class="mb-4 text-sm text-gray-700 dark:text-gray-300">The live site still has the last published look. Submit these changes when you are ready.</p>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading brand and design…</p>
    <div v-else class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div class="space-y-8">
        <section class="rounded-xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Colours</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label v-for="field in TOKEN_FIELDS" :key="field.key" class="flex items-center gap-3 text-sm">
              <input type="color" class="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" :value="doc.tokens[field.key]" :disabled="!canEdit" @input="setToken(field.key, ($event.target as HTMLInputElement).value)" />
              <span class="flex-1">
                <span class="block font-medium text-gray-800 dark:text-gray-200">{{ field.label }}</span>
                <input class="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 font-mono text-xs" :value="doc.tokens[field.key]" :disabled="!canEdit" @change="setToken(field.key, ($event.target as HTMLInputElement).value)" />
              </span>
            </label>
          </div>
          <label class="mt-3 flex items-center gap-3 text-sm">
            <input type="color" class="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" :value="logoPillPicker" :disabled="!canEdit" @input="setLogoPill(($event.target as HTMLInputElement).value)" />
            <span class="flex-1">
              <span class="block font-medium text-gray-800 dark:text-gray-200">Logo background</span>
              <input class="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 font-mono text-xs" :value="doc.tokens.logoPill ?? ''" :disabled="!canEdit" @change="setLogoPill(($event.target as HTMLInputElement).value)" />
              <button type="button" class="mt-2 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200" :disabled="!canEdit" @click="setLogoPill('')">Use white</button>
            </span>
          </label>
          <p class="mt-2 mb-0 text-sm text-gray-500 dark:text-gray-400">White unless you choose a colour. Used behind the logo in the footer and the see-through header.</p>
        </section>
        <section class="rounded-xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Type</h2>
          <FwbInput :model-value="doc.fonts.body" label="Body font" :disabled="!canEdit" @update:model-value="patch({ fonts: { ...doc.fonts, body: String($event) } })" />
          <div class="mt-3">
            <FwbInput :model-value="doc.fonts.heading ?? ''" label="Heading font (optional)" :disabled="!canEdit" @update:model-value="patch({ fonts: { ...doc.fonts, heading: String($event).trim() || null } })" />
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Logo</h2>
          <div class="flex flex-wrap items-center gap-3">
            <img v-if="logoPreview" :src="logoPreview" alt="Logo" class="h-12 max-w-40 object-contain" />
            <FwbButton v-if="canEdit" size="sm" color="light" @click="showLogo = true">{{ doc.logoMediaId ? 'Change logo' : 'Choose a logo' }}</FwbButton>
            <FwbButton v-if="canEdit && doc.logoMediaId" size="sm" color="light" @click="patch({ logoMediaId: null }); logoPreview = null">Remove</FwbButton>
          </div>
          <p class="mt-4 mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Logo for dark backgrounds</p>
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">Used when the header or footer is set to a dark background. If you leave this empty, a light version is made from the main logo with a CSS filter.</p>
          <div class="flex flex-wrap items-center gap-3">
            <img v-if="logoDarkPreview" :src="logoDarkPreview" alt="Logo for dark backgrounds" class="h-12 max-w-40 object-contain bg-gray-900 p-2" />
            <FwbButton v-if="canEdit" size="sm" color="light" @click="showLogoDark = true">{{ doc.logoDarkMediaId ? 'Change dark logo' : 'Choose a dark logo' }}</FwbButton>
            <FwbButton v-if="canEdit && doc.logoDarkMediaId" size="sm" color="light" @click="patch({ logoDarkMediaId: null }); logoDarkPreview = null">Remove</FwbButton>
          </div>
        </section>
        <section class="rounded-xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Menu look</h2>
          <UiCard tone="accent" to="/site-parts">
            <p class="m-0 text-sm text-gray-800 dark:text-gray-200">The menu look is now chosen in one place, with the menu itself: <strong>Site parts › Header and top strip</strong>.</p>
          </UiCard>
        </section>
        <section class="rounded-xl border border-gray-200/90 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Theme</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">This site uses the default theme. One theme per site in v1. A later full theme can change section layouts as well as colours.</p>
        </section>
        <section v-if="warnings.length" class="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <h2 class="mt-0 mb-3 text-base font-semibold text-gray-900 dark:text-white">Contrast</h2>
          <ul class="m-0 list-disc space-y-1 pl-5 text-sm text-amber-800">
            <li v-for="(issue, i) in warnings" :key="i">{{ issue.message }}</li>
          </ul>
        </section>
        <p v-if="!canEdit" class="text-sm text-gray-500 dark:text-gray-400">Only admins can change the brand and design.</p>
      </div>
      <div class="lg:sticky lg:top-6 lg:self-start">
        <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">Preview</p>
        <div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <component :is="'style'">{{ previewCss }}</component>
          <div class="sb-brand-preview">
            <header class="site-header">
              <div class="site-header-inner">
                <a class="site-title" href="#">{{ logoPreview ? '' : 'Example charity' }}</a>
                <img v-if="logoPreview" :src="logoPreview" alt="" class="h-8 max-w-32 object-contain" />
                <nav class="nav">
                  <a href="#">Home</a>
                  <details open>
                    <summary>About</summary>
                    <ul>
                      <li><a href="#">Our team</a></li>
                      <li><a href="#">Our story</a></li>
                    </ul>
                  </details>
                  <a href="#">Adopt</a>
                </nav>
                <a class="cta-btn" href="#">Donate</a>
              </div>
            </header>
            <div class="px-6 py-10">
              <h1 class="m-0 text-3xl">Keep them warm this winter</h1>
              <p class="mt-3">Body text on the page background, with a <a href="#">link in the accent colour</a>.</p>
              <a class="btn mt-4 inline-block" href="#">Donate now</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <MediaPickerModal v-if="showLogo" :selected-id="doc.logoMediaId" @close="showLogo = false" @pick="onLogo" />
    <MediaPickerModal v-if="showLogoDark" :selected-id="doc.logoDarkMediaId" @close="showLogoDark = false" @pick="onLogoDark" />

    <FwbModal v-if="showSubmit" @close="showSubmit = false">
      <template #header>Submit for approval</template>
      <template #body>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">An approver will review this look. After it is published, every page will be updated (about a minute).</p>
        <FwbInput v-model="submitNote" label="Note for the approver (optional)" />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showSubmit = false">Cancel</FwbButton>
          <FwbButton :disabled="submitting" @click="onSubmit">{{ submitting ? 'Submitting…' : 'Submit' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
