<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { can } from '#shared/roles'
import { HEADER_STYLE_HELP, HEADER_STYLE_LABELS, type HeaderStyle } from '#shared/site-parts'
import { defaultBrandDoc, type BrandDoc, type BrandTokens } from '#shared/brand'
import { themeCssFromTokens } from '#shared/theme-css'
import { scopeThemeCss } from '../../utils/theme-css'
import { mediaFileUrl, type MediaItem } from '../../utils/media'
import { statusLabel, type WorkflowState } from '#shared/workflow'
import type { FieldIssue } from '#shared/issues'
import MediaPickerModal from '../../components/media/MediaPickerModal.vue'

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
let timer: ReturnType<typeof setTimeout> | null = null

const TOKEN_FIELDS: { key: keyof BrandTokens; label: string }[] = [
  { key: 'ink', label: 'Body text' },
  { key: 'paper', label: 'Page background' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentInk', label: 'Text on accent' },
  { key: 'line', label: 'Lines' },
  { key: 'band', label: 'Bands' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'celebrate', label: 'Celebrate' },
]

const canSubmitNow = computed(() => {
  const p = pack.value
  if (!p || !canEdit.value) return false
  if (p.workflowState !== 'draft' && p.workflowState !== 'published' && p.workflowState !== 'unpublished') return false
  return p.draftVersionId !== p.publishedVersionId
})

const previewCss = computed(() => scopeThemeCss(themeCssFromTokens(doc.value.tokens, doc.value.fonts), '.sb-brand-preview'))
const status = computed(() => (pack.value ? statusLabel(pack.value.workflowState, !!pack.value.publishedVersionId && pack.value.publishedVersionId !== pack.value.draftVersionId) : 'Draft'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ pack: { id: string; workflowState: WorkflowState; publishedVersionId: string | null; draftVersionId: string | null }; doc: BrandDoc; revision: number; checks: { warnings: FieldIssue[] } }>('/brand')
    pack.value = data.pack
    doc.value = data.doc
    revision.value = data.revision
    warnings.value = data.checks.warnings
    if (data.doc.logoMediaId) await loadLogo(data.doc.logoMediaId)
    else logoPreview.value = null
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the brand pack.'
  } finally {
    loading.value = false
  }
}

async function loadLogo(id: string) {
  try {
    const item = await api<MediaItem & { preview?: string | null; renditions?: string[] }>(`/media/${id}`)
    const name = item.preview ?? item.renditions?.find((n) => n.endsWith('.webp')) ?? item.renditions?.[0]
    logoPreview.value = name ? mediaFileUrl(id, name) : null
  } catch {
    logoPreview.value = null
  }
}

function scheduleSave() {
  if (!canEdit.value) return
  saveStatus.value = 'saving'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), 600)
}

async function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!canEdit.value) return
  saveStatus.value = 'saving'
  error.value = ''
  try {
    const result = await api<{ revision: number; doc: BrandDoc; warnings: FieldIssue[] }>('/brand/ops', {
      method: 'POST',
      body: { baseRevision: revision.value, ops: [{ op: 'replace', doc: doc.value }] },
    })
    revision.value = result.revision
    warnings.value = result.warnings ?? []
    saveStatus.value = 'saved'
    // Reload pack pointers so Submit knows there are changes.
    const fresh = await api<{ pack: typeof pack.value; checks: { warnings: FieldIssue[] } }>('/brand')
    pack.value = fresh.pack
    warnings.value = fresh.checks?.warnings ?? warnings.value
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save the brand pack.'
    saveStatus.value = 'error'
  }
}

function patch(update: Partial<BrandDoc>) {
  doc.value = { ...doc.value, ...update }
  scheduleSave()
}

function setToken(key: keyof BrandTokens, value: string) {
  doc.value = { ...doc.value, tokens: { ...doc.value.tokens, [key]: value } }
  scheduleSave()
}

function onLogo(item: MediaItem) {
  showLogo.value = false
  patch({ logoMediaId: item.id })
  void loadLogo(item.id)
}

async function onSubmit() {
  await flush()
  submitting.value = true
  error.value = ''
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
  void flush()
})
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100">Brand and Design</h1>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">Colours, type, the logo, and how the menu looks — without changing the links in it.</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="sb-status" :class="pack?.workflowState === 'published' ? 'sb-status-published' : 'sb-status-draft'">{{ status }}</span>
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : 'Saved' }}</span>
        <FwbButton v-if="canSubmitNow" size="sm" :disabled="submitting || saveStatus === 'saving'" @click="showSubmit = true">Submit for approval</FwbButton>
      </div>
    </div>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading brand and design…</p>
    <div v-else class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div class="space-y-8">
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Colours</h2>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label v-for="field in TOKEN_FIELDS" :key="field.key" class="flex items-center gap-3 text-sm">
              <input type="color" class="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800" :value="doc.tokens[field.key]" :disabled="!canEdit" @input="setToken(field.key, ($event.target as HTMLInputElement).value)" />
              <span class="flex-1">
                <span class="block font-medium text-gray-800 dark:text-gray-200">{{ field.label }}</span>
                <input class="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 font-mono text-xs" :value="doc.tokens[field.key]" :disabled="!canEdit" @change="setToken(field.key, ($event.target as HTMLInputElement).value)" />
              </span>
            </label>
          </div>
        </section>
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Type</h2>
          <FwbInput :model-value="doc.fonts.body" label="Body font" :disabled="!canEdit" @update:model-value="patch({ fonts: { ...doc.fonts, body: String($event) } })" />
          <div class="mt-3">
            <FwbInput :model-value="doc.fonts.heading ?? ''" label="Heading font (optional)" :disabled="!canEdit" @update:model-value="patch({ fonts: { ...doc.fonts, heading: String($event).trim() || null } })" />
          </div>
        </section>
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Logo</h2>
          <div class="flex flex-wrap items-center gap-3">
            <img v-if="logoPreview" :src="logoPreview" alt="Logo" class="h-12 max-w-40 object-contain" />
            <FwbButton v-if="canEdit" size="sm" color="light" @click="showLogo = true">{{ doc.logoMediaId ? 'Change logo' : 'Choose a logo' }}</FwbButton>
            <FwbButton v-if="canEdit && doc.logoMediaId" size="sm" color="light" @click="patch({ logoMediaId: null }); logoPreview = null">Remove</FwbButton>
          </div>
        </section>
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Menu look</h2>
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">Pick a look for the same menu. The links stay as they are, and are edited under Site parts.</p>
          <fieldset class="space-y-2" :disabled="!canEdit">
            <label v-for="(label, value) in HEADER_STYLE_LABELS" :key="value" class="flex cursor-pointer gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50">
              <input type="radio" class="mt-0.5 text-blue-700 dark:text-blue-400" :value="value" :checked="doc.menuStyle === value" @change="patch({ menuStyle: value as HeaderStyle })" />
              <span>
                <span class="block font-medium text-gray-900 dark:text-gray-100">{{ label }}</span>
                <span class="text-gray-600 dark:text-gray-400">{{ HEADER_STYLE_HELP[value as HeaderStyle] }}</span>
              </span>
            </label>
          </fieldset>
        </section>
        <section>
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Theme</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">This site uses the default theme. One theme per site in v1. A later full theme can change section layouts as well as colours.</p>
        </section>
        <section v-if="warnings.length">
          <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Contrast</h2>
          <ul class="m-0 list-disc space-y-1 pl-5 text-sm text-amber-800">
            <li v-for="(issue, i) in warnings" :key="i">{{ issue.message }}</li>
          </ul>
        </section>
        <p v-if="!canEdit" class="text-sm text-gray-500 dark:text-gray-400">Only admins can change the brand and design.</p>
      </div>
      <div>
        <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">Preview</p>
        <div class="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <component :is="'style'">{{ previewCss }}</component>
          <div class="sb-brand-preview">
            <header :class="doc.menuStyle === 'centred' ? 'site-header site-header-centred' : doc.menuStyle === 'hamburger' ? 'site-header site-header-hamburger' : doc.menuStyle === 'mega' ? 'site-header site-header-mega' : 'site-header'">
              <div class="site-header-inner">
                <a class="site-title" href="#">{{ logoPreview ? '' : 'Example charity' }}</a>
                <img v-if="logoPreview" :src="logoPreview" alt="" class="h-8 max-w-32 object-contain" />
                <details v-if="doc.menuStyle === 'hamburger'" class="nav nav-hamburger" open>
                  <summary>Menu</summary>
                  <div class="nav-panel">
                    <a href="#">Home</a>
                    <a href="#">About</a>
                    <a href="#">Adopt</a>
                  </div>
                </details>
                <nav v-else :class="doc.menuStyle === 'mega' ? 'nav nav-mega' : 'nav'">
                  <a href="#">Home</a>
                  <details open>
                    <summary>About</summary>
                    <ul :class="doc.menuStyle === 'mega' ? 'nav-mega-panel' : undefined">
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
