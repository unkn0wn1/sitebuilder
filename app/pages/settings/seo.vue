<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import type { SettingsPayload } from '../../utils/settings'
import SettingsNav from '../../components/settings/SettingsNav.vue'
import MediaPickerModal from '../../components/media/MediaPickerModal.vue'
import type { MediaItem } from '../../utils/media'
import { defaultRobotsTxt, sanitizeRobotsTxt } from '#shared/robots'

definePageMeta({ layout: 'builder' })

interface RedirectItem {
  id: string
  fromPath: string
  toPath: string
  statusCode: number
  source: string
}

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')
const allowIndexing = ref(true)
const robotsTxt = ref('')
const robotsError = ref('')
const defaultSocialImage = ref<string | null>(null)
const showPicker = ref(false)
const redirects = ref<RedirectItem[]>([])
const fromPath = ref('')
const toPath = ref('')
const statusCode = ref<'301' | '302'>('301')
const adding = ref(false)

const statusOptions = [
  { name: 'Permanent (301)', value: '301' },
  { name: 'Temporary (302)', value: '302' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<SettingsPayload>('/settings')
    allowIndexing.value = data.settings.seo.allowIndexing
    defaultSocialImage.value = data.settings.seo.defaultSocialImage
    robotsTxt.value = data.settings.seo.robotsTxt ?? defaultRobotsTxt(data.primaryDomain ? `https://${data.primaryDomain}` : null)
    robotsError.value = ''
    const list = await api<{ items: RedirectItem[] }>('/redirects')
    redirects.value = list.items
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load settings.'
  } finally {
    loading.value = false
  }
}

function robotsForSave(): { ok: true; text: string | null } | { ok: false } {
  const raw = robotsTxt.value
  const fallback = defaultRobotsTxt()
  if (!raw.trim() || raw.trim() === fallback.trim()) return { ok: true, text: null }
  const clean = sanitizeRobotsTxt(raw)
  if (!clean.ok) {
    robotsError.value = clean.message
    return { ok: false }
  }
  robotsError.value = ''
  return { ok: true, text: clean.text }
}

async function saveSeo() {
  saving.value = true
  error.value = ''
  saved.value = ''
  robotsError.value = ''
  try {
    const custom = robotsForSave()
    if (!custom.ok) return
    await api('/settings', { method: 'PATCH', body: { seo: { allowIndexing: allowIndexing.value, defaultSocialImage: defaultSocialImage.value, robotsTxt: custom.text } } })
    saved.value = 'Saved. Changes to robots.txt apply the next time the site is published.'
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not save settings.'
  } finally {
    saving.value = false
  }
}

async function addRedirect() {
  if (!fromPath.value.trim() || !toPath.value.trim()) return
  adding.value = true
  error.value = ''
  try {
    await api('/redirects', { method: 'POST', body: { fromPath: fromPath.value.trim(), toPath: toPath.value.trim(), statusCode: Number(statusCode.value) } })
    fromPath.value = ''
    toPath.value = ''
    statusCode.value = '301'
    const list = await api<{ items: RedirectItem[] }>('/redirects')
    redirects.value = list.items
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not add that redirect.'
  } finally {
    adding.value = false
  }
}

async function removeRedirect(id: string) {
  if (!confirm('Delete this redirect?')) return
  error.value = ''
  try {
    await api(`/redirects/${id}`, { method: 'DELETE' })
    redirects.value = redirects.value.filter((item) => item.id !== id)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not delete that redirect.'
  }
}

const sourceLabel: Record<string, string> = {
  manual: 'Added here',
  slug_change: 'Address change',
  unpublish: 'Page taken offline',
}

function onPickImage(item: MediaItem) {
  defaultSocialImage.value = item.id
  showPicker.value = false
}

onMounted(load)
</script>

<template>
  <div class="p-6">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">SEO and redirects</h1>
      </template>
    </SettingsNav>
    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading settings…</p>
    <div v-else class="max-w-3xl space-y-10">
      <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
      <FwbAlert v-else-if="saved" type="success">{{ saved }}</FwbAlert>

      <form class="max-w-xl" @submit.prevent="saveSeo">
        <div class="mb-4">
          <FwbToggle v-model="allowIndexing" label="Allow search engines to index this site" />
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">When this is off, pages ask search engines not to list them.</p>
        </div>
        <div class="mb-6">
          <label class="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100" for="robots-txt">robots.txt</label>
          <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">
            A safe default is filled in for you. If indexing is switched off, this site always serves <code>Disallow: /</code>, even if you edit this text. A Sitemap line is added on publish when indexing is on and you have not included one.
          </p>
          <textarea
            id="robots-txt"
            v-model="robotsTxt"
            class="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2.5 font-mono text-sm text-gray-900 dark:text-gray-100"
            :rows="8"
            spellcheck="false"
          />
          <p v-if="robotsError" class="mt-2 text-sm text-red-700 dark:text-red-400">{{ robotsError }}</p>
        </div>
        <div class="mb-6">
          <p class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">Default social image</p>
          <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">Used when a page doesn't set its own image for shares.</p>
          <p class="mb-2 text-sm text-gray-700 dark:text-gray-300">{{ defaultSocialImage ? 'An image is set.' : 'No default image yet.' }}</p>
          <div class="flex flex-wrap gap-2">
            <FwbButton color="light" size="sm" type="button" @click="showPicker = true">{{ defaultSocialImage ? 'Change image' : 'Choose image' }}</FwbButton>
            <FwbButton v-if="defaultSocialImage" color="light" size="sm" type="button" @click="defaultSocialImage = null">Remove</FwbButton>
          </div>
        </div>
        <FwbButton type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</FwbButton>
      </form>

      <section>
        <h2 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Redirects</h2>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">Send an old address to a new one. Some are added automatically when a live page moves or is taken offline.</p>
        <form class="mb-6 flex flex-wrap items-end gap-3" @submit.prevent="addRedirect">
          <div class="w-40">
            <FwbInput v-model="fromPath" label="From" placeholder="/old-page" />
          </div>
          <div class="w-52">
            <FwbInput v-model="toPath" label="To" placeholder="/new-page or https://…" />
          </div>
          <div class="w-48">
            <FwbSelect :model-value="statusCode" label="Type" :options="statusOptions" @update:model-value="statusCode = String($event) === '302' ? '302' : '301'" />
          </div>
          <FwbButton type="submit" :disabled="adding">{{ adding ? 'Adding…' : 'Add redirect' }}</FwbButton>
        </form>
        <p v-if="!redirects.length" class="text-sm text-gray-500 dark:text-gray-400">No redirects yet.</p>
        <FwbTable v-else hoverable>
          <FwbTableHead>
            <FwbTableHeadCell>From</FwbTableHeadCell>
            <FwbTableHeadCell>To</FwbTableHeadCell>
            <FwbTableHeadCell>Type</FwbTableHeadCell>
            <FwbTableHeadCell>Source</FwbTableHeadCell>
            <FwbTableHeadCell><span class="sr-only">Actions</span></FwbTableHeadCell>
          </FwbTableHead>
          <FwbTableBody>
            <FwbTableRow v-for="item in redirects" :key="item.id">
              <FwbTableCell>{{ item.fromPath }}</FwbTableCell>
              <FwbTableCell>{{ item.toPath }}</FwbTableCell>
              <FwbTableCell>{{ item.statusCode }}</FwbTableCell>
              <FwbTableCell>{{ sourceLabel[item.source] ?? item.source }}</FwbTableCell>
              <FwbTableCell>
                <FwbButton color="light" size="sm" @click="removeRedirect(item.id)">Delete</FwbButton>
              </FwbTableCell>
            </FwbTableRow>
          </FwbTableBody>
        </FwbTable>
      </section>
    </div>
    <MediaPickerModal v-if="showPicker" :selected-id="defaultSocialImage" @close="showPicker = false" @pick="onPickImage" />
  </div>
</template>
