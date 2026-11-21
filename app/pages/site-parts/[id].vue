<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { can } from '#shared/roles'
import type { BannerDoc, FooterDoc, HeaderDoc, MenuDoc, SitePartDoc } from '#shared/site-parts'
import { KIND_LABELS, type PageOption, type SitePartDetail, type SitePartListItem } from '../../utils/site-parts'
import MenuEditor from '../../components/site-parts/MenuEditor.vue'
import HeaderEditor from '../../components/site-parts/HeaderEditor.vue'
import FooterEditor from '../../components/site-parts/FooterEditor.vue'
import BannerEditor from '../../components/site-parts/BannerEditor.vue'
import PartPreview from '../../components/site-parts/PartPreview.vue'

definePageMeta({ layout: 'builder' })

const route = useRoute()
const { user, site } = useSession()
const id = computed(() => String(route.params.id))
const editor = useSitePartEditor(id)
const loading = ref(true)
const loadError = ref('')
const pages = ref<PageOption[]>([])
const menus = ref<SitePartListItem[]>([])
const menuDocs = ref<Record<string, MenuDoc>>({})
const device = ref<'computer' | 'phone'>(import.meta.client && window.innerWidth < 768 ? 'phone' : 'computer')
const showSubmit = ref(false)
const submitNote = ref('')
const previewMenus = computed(() => {
  const out = { ...menuDocs.value }
  if (editor.part.value?.kind === 'menu' && editor.doc.value) out[editor.part.value.key] = editor.doc.value as MenuDoc
  return out
})

const canEdit = computed(() => !!user.value && can(user.value, 'sitePart.edit'))

const saveLabel = computed(() => {
  switch (editor.saveStatus.value) {
    case 'saving':
      return 'Saving…'
    case 'conflict':
      return 'Conflict'
    case 'error':
      return 'Not saved'
    default:
      return 'Saved'
  }
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [pageData, partData] = await Promise.all([
      api<{ items: PageOption[] }>('/pages?page=1&pageSize=100'),
      api<{ items: SitePartListItem[] }>('/site-parts'),
    ])
    pages.value = pageData.items
    menus.value = partData.items
    const loaded = await Promise.all(
      partData.items
        .filter((item) => item.kind === 'menu')
        .map(async (item) => {
          const detail = await api<SitePartDetail>(`/site-parts/${item.id}`)
          return [item.key, detail.doc as MenuDoc] as const
        }),
    )
    menuDocs.value = Object.fromEntries(loaded)
    await editor.load()
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Could not open this site part.'
  } finally {
    loading.value = false
  }
}

watch(id, load, { immediate: true })

function onDoc(next: SitePartDoc) {
  if (!canEdit.value) return
  editor.patch(next)
}

async function onSubmit() {
  await editor.submit(submitNote.value.trim() || undefined)
  if (!editor.error.value) {
    showSubmit.value = false
    submitNote.value = ''
  }
}
</script>

<template>
  <div>
    <p v-if="loading" class="p-8 text-gray-500 dark:text-gray-400">Opening…</p>
    <div v-else-if="loadError" class="p-6">
      <FwbAlert type="danger">{{ loadError }}</FwbAlert>
      <NuxtLink to="/site-parts" class="mt-4 inline-block text-sm">Back to site parts</NuxtLink>
    </div>
    <div v-else-if="editor.part.value && editor.doc.value" class="flex h-[calc(100vh-3.25rem)] min-h-0 flex-col">
      <header class="flex flex-wrap items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2">
        <NuxtLink to="/site-parts" class="text-sm text-gray-600 dark:text-gray-400 no-underline hover:underline">&lt; Site parts</NuxtLink>
        <h1 class="m-0 text-base font-semibold text-gray-900 dark:text-gray-100">{{ editor.part.value.label }}</h1>
        <span class="text-sm text-gray-500 dark:text-gray-400">{{ KIND_LABELS[editor.part.value.kind] }}</span>
        <BuilderStatusBadge :state="editor.part.value.workflowState" :has-unpublished-changes="editor.hasUnpublishedChanges.value" />
        <span class="text-sm text-gray-500 dark:text-gray-400" data-testid="save-status">{{ saveLabel }}</span>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <FwbButtonGroup>
            <FwbButton size="sm" :color="device === 'computer' ? 'default' : 'light'" @click="device = 'computer'">Computer</FwbButton>
            <FwbButton size="sm" :color="device === 'phone' ? 'default' : 'light'" @click="device = 'phone'">Phone</FwbButton>
          </FwbButtonGroup>
          <FwbButton
            v-if="canEdit && editor.canSubmitNow.value"
            size="sm"
            :disabled="editor.submitting.value || editor.saveStatus.value === 'saving'"
            @click="showSubmit = true"
          >
            Submit for approval
          </FwbButton>
        </div>
      </header>
      <FwbAlert v-if="editor.error.value" type="danger" class="rounded-none">{{ editor.error.value }}</FwbAlert>
      <FwbAlert v-else-if="editor.warnings.value.length" type="warning" class="rounded-none">
        {{ editor.warnings.value.map((w) => w.message).join(' ') }}
      </FwbAlert>
      <div v-if="editor.conflict.value" class="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p class="mb-2">{{ editor.conflict.value.message }}</p>
        <div class="flex gap-2">
          <FwbButton size="sm" @click="editor.keepMine()">Keep mine</FwbButton>
          <FwbButton size="sm" color="light" @click="editor.useTheirs()">Use theirs</FwbButton>
        </div>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto p-4 lg:grid-cols-2">
        <div class="min-w-0">
          <MenuEditor
            v-if="editor.part.value.kind === 'menu'"
            :model-value="editor.doc.value as MenuDoc"
            :pages="pages"
            @update:model-value="onDoc"
          />
          <HeaderEditor
            v-else-if="editor.part.value.kind === 'header'"
            :model-value="editor.doc.value as HeaderDoc"
            :pages="pages"
            :menus="menus"
            @update:model-value="onDoc"
          />
          <FooterEditor
            v-else-if="editor.part.value.kind === 'footer'"
            :model-value="editor.doc.value as FooterDoc"
            :menus="menus"
            @update:model-value="onDoc"
          />
          <BannerEditor
            v-else-if="editor.part.value.kind === 'banner'"
            :model-value="editor.doc.value as BannerDoc"
            :pages="pages"
            @update:model-value="onDoc"
          />
          <p v-if="!canEdit" class="mt-4 text-sm text-gray-500 dark:text-gray-400">Only approvers and admins can change this.</p>
        </div>
        <div class="min-w-0">
          <p class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200">Preview</p>
          <PartPreview
            :kind="editor.part.value.kind"
            :doc="editor.doc.value"
            :site-name="site?.name ?? 'This site'"
            :menus="previewMenus"
            :pages="pages"
            :device="device"
          />
        </div>
      </div>
    </div>

    <FwbModal v-if="showSubmit" @close="showSubmit = false">
      <template #header>Submit for approval</template>
      <template #body>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">An approver will review this change. After it is published, every page that uses it will be updated (about a minute).</p>
        <FwbInput v-model="submitNote" label="Note for the approver (optional)" />
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showSubmit = false">Cancel</FwbButton>
          <FwbButton :disabled="editor.submitting.value" @click="onSubmit">{{ editor.submitting.value ? 'Submitting…' : 'Submit' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
