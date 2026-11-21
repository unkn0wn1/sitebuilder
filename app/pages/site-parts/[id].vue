<script setup lang="ts">
// The site-part editor (docs/19-admin-redesign.md): the real page in the middle, drawn by the publish renderer with
// the draft swapped in, and the fields in a panel on the right. The header screen also edits the top strip.
import { api, ApiError } from '../../utils/api'
import { can } from '#shared/roles'
import type { BannerDoc, FooterDoc, HeaderDoc, MenuDoc, SitePartDoc } from '#shared/site-parts'
import { KIND_LABELS, type PageOption, type SitePartListItem } from '../../utils/site-parts'
import type { Device } from '../../utils/page-editor'
import MenuEditor from '../../components/site-parts/MenuEditor.vue'
import HeaderEditor from '../../components/site-parts/HeaderEditor.vue'
import FooterEditor from '../../components/site-parts/FooterEditor.vue'
import BannerEditor from '../../components/site-parts/BannerEditor.vue'
import RenderedPage from '../../components/preview/RenderedPage.vue'

definePageMeta({ layout: 'builder' })

const route = useRoute()
const { user } = useSession()
const id = computed(() => String(route.params.id))
const editor = useSitePartEditor(id)
const stripId = ref('')
const strip = useSitePartEditor(stripId)
const loading = ref(true)
const loadError = ref('')
const pages = ref<PageOption[]>([])
const parts = ref<SitePartListItem[]>([])
const device = ref<Device>(import.meta.client && window.innerWidth < 768 ? 'mobile' : 'desktop')
const previewPageId = ref('')
const mobileView = ref<'edit' | 'preview'>('edit')
const showSubmit = ref(false)
const submitNote = ref('')
const submitWhich = ref<string[]>([])
const addingStrip = ref(false)
const menuUse = ref<string | null>(null)
const focusItem = ref<number | null>(null)
const preview = ref<InstanceType<typeof RenderedPage> | null>(null)
let scrolledToFooter = false

const kind = computed(() => editor.part.value?.kind ?? null)
const canEdit = computed(() => !!user.value && can(user.value, 'sitePart.edit'))
const livePages = computed(() => pages.value.filter((p) => p.state === 'published' || p.state === 'in_review' || p.state === 'approved'))

const payload = computed(() => {
  const p = editor.part.value
  if (!p || !editor.doc.value) return undefined
  const list = [{ partId: p.id, doc: editor.doc.value }]
  if (p.kind === 'header' && strip.part.value && strip.doc.value) list.push({ partId: strip.part.value.id, doc: strip.doc.value })
  return { parts: list, pageId: previewPageId.value || undefined }
})

function statusText(status: string) {
  return status === 'saving' ? 'Saving…' : status === 'conflict' ? 'Conflict' : status === 'error' ? 'Not saved' : 'Saved'
}
const saveLabel = computed(() => {
  const statuses = [editor.saveStatus.value, ...(stripId.value ? [strip.saveStatus.value] : [])]
  for (const s of ['error', 'conflict', 'saving']) if (statuses.includes(s as never)) return statusText(s)
  return 'Saved'
})

const submittable = computed(() => {
  const out: { id: string; label: string; ed: typeof editor }[] = []
  if (editor.canSubmitNow.value && editor.part.value) out.push({ id: editor.part.value.id, label: editor.part.value.kind === 'header' ? 'Header' : editor.part.value.label, ed: editor })
  if (kind.value === 'header' && strip.canSubmitNow.value && strip.part.value) out.push({ id: strip.part.value.id, label: 'Top strip', ed: strip })
  return out
})
const anyError = computed(() => editor.error.value || strip.error.value)

async function load() {
  loading.value = true
  loadError.value = ''
  scrolledToFooter = false
  try {
    const [pageData, partData] = await Promise.all([api<{ items: PageOption[] }>('/pages?page=1&pageSize=100'), api<{ items: SitePartListItem[] }>('/site-parts')])
    pages.value = pageData.items
    parts.value = partData.items
    const me = partData.items.find((p) => p.id === id.value)
    const header = partData.items.find((p) => p.kind === 'header')
    // The top strip is edited on the header screen.
    if (me?.kind === 'banner' && header) {
      await navigateTo(`/site-parts/${header.id}?focus=strip`, { replace: true })
      return
    }
    await editor.load()
    const banner = partData.items.find((p) => p.kind === 'banner')
    if (editor.part.value?.kind === 'header' && banner) {
      stripId.value = banner.id
      await strip.load()
    } else stripId.value = ''
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not open this site part.'
  } finally {
    loading.value = false
  }
  if (route.query.focus === 'strip') nextTick(() => document.querySelector('[data-section="strip"]')?.scrollIntoView({ block: 'start' }))
}

watch(id, load, { immediate: true })

function onDoc(next: SitePartDoc) {
  if (canEdit.value) editor.patch(next)
}
function onStrip(next: BannerDoc) {
  if (canEdit.value) strip.patch(next)
}

async function addStrip() {
  addingStrip.value = true
  try {
    const made = await api<{ id: string }>('/site-parts', { method: 'POST', body: { kind: 'banner', label: 'Top strip' } })
    parts.value = (await api<{ items: SitePartListItem[] }>('/site-parts')).items
    stripId.value = made.id
    await strip.load()
    if (strip.doc.value) strip.patch({ ...(strip.doc.value as BannerDoc), enabled: true, message: '' })
  } catch (err) {
    editor.error.value = err instanceof ApiError ? err.message : 'Could not add a top strip.'
  } finally {
    addingStrip.value = false
  }
}

// Menu: open the panel of the item being edited, so mega panels can be checked.
function openPanel(doc: Document | null) {
  if (!doc || kind.value !== 'menu') return
  const list = doc.querySelector('header nav ul')
  Array.from(list?.children ?? []).forEach((li, i) => {
    const details = li.querySelector('details')
    if (details) details.open = i === focusItem.value
  })
}
watch(focusItem, () => openPanel(preview.value?.frameDocument() ?? null))
function onRendered(doc: Document) {
  openPanel(doc)
  if (kind.value === 'footer' && !scrolledToFooter) {
    scrolledToFooter = true
    nextTick(() => preview.value?.scrollToSelector('footer', false))
  }
}
function onMeta(meta: Record<string, unknown>) {
  menuUse.value = typeof meta.menuUse === 'string' ? meta.menuUse : null
}
const MENU_USE: Record<string, string> = {
  header: 'Shown in the header',
  footer: 'Shown in the footer links',
  legal: 'Shown as the footer’s legal links',
  unused: 'Not used yet. The preview shows it in the header so you can see it.',
}

function openSubmit() {
  submitWhich.value = submittable.value.map((s) => s.id)
  showSubmit.value = true
}
async function onSubmit() {
  const note = submitNote.value.trim() || undefined
  for (const s of submittable.value.filter((x) => submitWhich.value.includes(x.id))) {
    await s.ed.submit(note)
    if (s.ed.error.value) return
  }
  showSubmit.value = false
  submitNote.value = ''
}
</script>

<template>
  <div>
    <div v-if="loading" class="sb-full grid place-items-center text-sm text-gray-500 dark:text-gray-400">Opening…</div>
    <div v-else-if="loadError" class="sb-page">
      <FwbAlert type="danger">{{ loadError }}</FwbAlert>
      <NuxtLink to="/site-parts" class="mt-4 inline-block text-sm">Back to site parts</NuxtLink>
    </div>
    <div v-else-if="editor.part.value && editor.doc.value" class="sb-full flex min-h-0 flex-col">
      <!-- Top bar -->
      <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-3 py-2 sm:px-4 dark:border-gray-800 dark:bg-gray-900">
        <NuxtLink to="/site-parts" class="grid size-8 place-items-center rounded-lg text-gray-500 no-underline hover:bg-gray-100 dark:hover:bg-gray-800" title="Back to site parts" aria-label="Back to site parts">
          <UiIcon name="back" :size="18" />
        </NuxtLink>
        <div class="min-w-0">
          <h1 class="m-0 truncate text-base font-semibold text-gray-900 dark:text-white">{{ kind === 'header' ? 'Header and top strip' : editor.part.value.label }}</h1>
          <p class="m-0 text-xs text-gray-500 dark:text-gray-400">{{ KIND_LABELS[editor.part.value.kind] }} · <span data-testid="save-status">{{ saveLabel }}</span></p>
        </div>
        <BuilderStatusBadge :state="editor.part.value.workflowState" :has-unpublished-changes="editor.hasUnpublishedChanges.value" />
        <span v-if="kind === 'header' && strip.part.value" class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          Strip <BuilderStatusBadge :state="strip.part.value.workflowState" :has-unpublished-changes="strip.hasUnpublishedChanges.value" />
        </span>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <label v-if="livePages.length > 1" class="hidden items-center gap-2 text-xs text-gray-500 md:flex dark:text-gray-400">
            Preview on
            <select v-model="previewPageId" class="rounded-lg border-gray-200 bg-white py-1 pl-2 pr-8 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
              <option value="">Home</option>
              <option v-for="p in livePages.filter((p) => p.path !== '/')" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <UiSegmented
            v-model="device"
            label="Device"
            compact
            :options="[
              { value: 'desktop', label: 'Desktop', icon: 'desktop' },
              { value: 'tablet', label: 'Tablet', icon: 'tablet' },
              { value: 'mobile', label: 'Mobile', icon: 'phone' },
            ]"
          />
          <FwbButton v-if="canEdit && submittable.length" size="sm" :disabled="editor.submitting.value || strip.submitting.value || saveLabel === 'Saving…'" @click="openSubmit">
            Submit for approval{{ submittable.length > 1 ? ` (${submittable.length})` : '' }}
          </FwbButton>
        </div>
      </header>
      <FwbAlert v-if="anyError" type="danger" class="rounded-none">{{ anyError }}</FwbAlert>
      <FwbAlert v-else-if="editor.warnings.value.length" type="warning" class="rounded-none">{{ editor.warnings.value.map((w) => w.message).join(' ') }}</FwbAlert>
      <div v-if="editor.conflict.value" class="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p class="mb-2">{{ editor.conflict.value.message }}</p>
        <div class="flex gap-2">
          <FwbButton size="sm" @click="editor.keepMine()">Keep mine</FwbButton>
          <FwbButton size="sm" color="light" @click="editor.useTheirs()">Use theirs</FwbButton>
        </div>
      </div>
      <!-- Phones: one at a time -->
      <div class="flex justify-center border-b border-gray-200 bg-white py-2 lg:hidden dark:border-gray-800 dark:bg-gray-900">
        <UiSegmented v-model="mobileView" label="Show" :options="[{ value: 'edit', label: 'Edit' }, { value: 'preview', label: 'Preview' }]" />
      </div>

      <div class="flex min-h-0 flex-1">
        <section class="min-h-0 min-w-0 flex-1 flex-col bg-gray-100 dark:bg-gray-950" :class="mobileView === 'preview' ? 'flex' : 'hidden lg:flex'" aria-label="Preview">
          <p v-if="kind === 'menu' && menuUse" class="m-0 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-1.5 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <UiIcon name="list" :size="14" /> {{ MENU_USE[menuUse] }}
          </p>
          <RenderedPage
            v-if="payload"
            ref="preview"
            endpoint="/preview/site-part"
            :payload="payload"
            :device="device"
            :selectable="false"
            :gutter="32"
            @rendered="onRendered"
            @meta="onMeta"
          />
        </section>
        <aside class="min-h-0 w-full shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-4 lg:w-[26rem] dark:border-gray-800 dark:bg-gray-950" :class="mobileView === 'edit' ? 'block' : 'hidden lg:block'" aria-label="Fields">
          <p v-if="!canEdit" class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Only approvers and admins can change site parts.</p>
          <HeaderEditor
            v-if="kind === 'header'"
            :model-value="editor.doc.value as HeaderDoc"
            :pages="pages"
            :menus="parts"
            :strip="(strip.doc.value as BannerDoc | null) ?? null"
            :can-edit="canEdit"
            :adding-strip="addingStrip"
            @update:model-value="onDoc"
            @update:strip="onStrip"
            @add-strip="addStrip"
          />
          <MenuEditor v-else-if="kind === 'menu'" :model-value="editor.doc.value as MenuDoc" :pages="pages" @update:model-value="onDoc" @focus="focusItem = $event" />
          <FooterEditor v-else-if="kind === 'footer'" :model-value="editor.doc.value as FooterDoc" :menus="parts" @update:model-value="onDoc" />
          <UiSection
            v-else-if="kind === 'banner'"
            title="Top strip"
            icon="strip"
            toggle
            :model-value="(editor.doc.value as BannerDoc).enabled"
            @update:model-value="onDoc({ ...(editor.doc.value as BannerDoc), enabled: $event })"
          >
            <BannerEditor :model-value="editor.doc.value as BannerDoc" :pages="pages" @update:model-value="onDoc" />
          </UiSection>
        </aside>
      </div>
    </div>

    <FwbModal v-if="showSubmit" @close="showSubmit = false">
      <template #header>Submit for approval</template>
      <template #body>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">An approver will review this. Once it’s published, every page shows it (about a minute).</p>
        <div v-if="submittable.length > 1" class="mb-4 space-y-2">
          <label v-for="s in submittable" :key="s.id" class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <input v-model="submitWhich" type="checkbox" class="rounded text-blue-600" :value="s.id" /> {{ s.label }}
          </label>
        </div>
        <FwbInput v-model="submitNote" label="Note for the approver (optional)" />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showSubmit = false">Cancel</FwbButton>
          <FwbButton :disabled="editor.submitting.value || strip.submitting.value || !submitWhich.length" @click="onSubmit">{{ editor.submitting.value || strip.submitting.value ? 'Submitting…' : 'Submit' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
