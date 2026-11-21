<script setup lang="ts">
// Site parts as the visitor meets them (docs/19-admin-redesign.md): the top of every page (top strip and header), the
// menus, and the bottom of every page (footer). Each card says what is in it now.
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { can } from '#shared/roles'
import { HEADER_STYLE_LABELS, type BannerDoc, type FooterDoc, type HeaderDoc, type MenuDoc, type SitePartDoc } from '#shared/site-parts'
import type { SitePartDetail, SitePartListItem } from '../../utils/site-parts'

definePageMeta({ layout: 'builder' })

const { user } = useSession()
const items = ref<SitePartListItem[]>([])
const docs = ref<Record<string, SitePartDoc>>({})
const error = ref('')
const loading = ref(true)
const showNewMenu = ref(false)
const newMenuLabel = ref('')
const creating = ref(false)
const canEdit = computed(() => !!user.value && can(user.value, 'sitePart.edit'))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: SitePartListItem[] }>('/site-parts')
    items.value = data.items
    const details = await Promise.all(data.items.map((p) => api<SitePartDetail>(`/site-parts/${p.id}`).then((d) => [p.id, d.doc] as const)))
    docs.value = Object.fromEntries(details)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load the site parts.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const header = computed(() => items.value.find((p) => p.kind === 'header') ?? null)
const strip = computed(() => items.value.find((p) => p.kind === 'banner') ?? null)
const footer = computed(() => items.value.find((p) => p.kind === 'footer') ?? null)
const menus = computed(() => items.value.filter((p) => p.kind === 'menu').sort((a, b) => a.label.localeCompare(b.label)))
const headerDoc = computed(() => (header.value ? (docs.value[header.value.id] as HeaderDoc | undefined) : undefined))
const stripDoc = computed(() => (strip.value ? (docs.value[strip.value.id] as BannerDoc | undefined) : undefined))
const footerDoc = computed(() => (footer.value ? (docs.value[footer.value.id] as FooterDoc | undefined) : undefined))
const headerMenu = computed(() => menus.value.find((m) => m.key === headerDoc.value?.menuKey) ?? null)

function usedIn(key: string): string[] {
  const out: string[] = []
  if (headerDoc.value?.menuKey === key) out.push('Header')
  if (footerDoc.value?.legalMenuKey === key) out.push('Footer legal links')
  return out
}
const menuLabels = (id: string) => ((docs.value[id] as MenuDoc | undefined)?.items ?? []).map((i) => i.label)
const subCount = (id: string) => ((docs.value[id] as MenuDoc | undefined)?.items ?? []).reduce((n, i) => n + i.children.length, 0)
const STRIP_TONE: Record<string, string> = { accent: 'bg-orange-700', info: 'bg-sky-600', urgent: 'bg-red-600', celebrate: 'bg-emerald-600' }

async function createMenu() {
  if (!newMenuLabel.value.trim()) return
  creating.value = true
  try {
    const made = await api<{ id: string }>('/site-parts', { method: 'POST', body: { kind: 'menu', label: newMenuLabel.value.trim() } })
    await navigateTo(`/site-parts/${made.id}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not add that menu.'
    creating.value = false
  }
}
</script>

<template>
  <div class="sb-page">
    <UiPageHeader title="Site parts" description="What every page shares: the top strip, the header and its menu, other menus and the footer. Changes go through approval, like pages do.">
      <FwbButton v-if="canEdit" color="light" @click="showNewMenu = true">
        <span class="inline-flex items-center gap-2"><UiIcon name="plus" :size="16" /> New menu</span>
      </FwbButton>
    </UiPageHeader>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>

    <div v-if="loading" class="space-y-4">
      <div v-for="n in 3" :key="n" class="h-40 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" />
    </div>
    <UiEmptyState v-else-if="!items.length" icon="parts" title="No site parts yet" description="Setup adds a header, a main menu and a footer. Run setup again, or ask an admin." />
    <div v-else class="space-y-10">
      <!-- Top of every page -->
      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Top of every page</h2>
        <UiCard v-if="header" :to="`/site-parts/${header.id}`" flush class="overflow-hidden">
          <!-- A small drawing of the top of the page, from the drafts -->
          <div class="border-b border-gray-100 bg-gray-50 p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-950/50">
            <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-900/5 dark:bg-gray-900">
              <div v-if="stripDoc?.enabled && stripDoc.message" class="truncate px-4 py-1.5 text-center text-xs font-medium text-white" :class="STRIP_TONE[stripDoc.tone]">
                {{ stripDoc.message }} <span v-if="stripDoc.link" class="underline">{{ stripDoc.link.label }}</span>
              </div>
              <div v-else class="border-b border-dashed border-gray-200 px-4 py-1 text-center text-[11px] text-gray-400 dark:border-gray-700">{{ strip ? 'Top strip is off' : 'No top strip' }}</div>
              <div class="flex items-center gap-4 px-4 py-3" :class="headerDoc?.appearance === 'dark' ? 'bg-gray-900 text-white' : ''">
                <span class="h-4 w-16 rounded bg-gray-300 dark:bg-gray-600" />
                <span class="hidden min-w-0 flex-1 gap-4 truncate text-xs text-gray-600 sm:flex dark:text-gray-300" :class="headerDoc?.appearance === 'dark' ? 'text-gray-200' : ''">
                  <span v-for="label in (headerMenu ? menuLabels(headerMenu.id) : []).slice(0, 6)" :key="label">{{ label }}</span>
                </span>
                <span v-if="headerDoc?.cta" class="ml-auto rounded-full bg-orange-700 px-3 py-1 text-xs font-semibold text-white">{{ headerDoc.cta.label }}</span>
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
            <div class="min-w-0 flex-1">
              <h3 class="m-0 text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">Header and top strip</h3>
              <p class="mt-0.5 mb-0 text-sm text-gray-600 dark:text-gray-400">
                {{ headerMenu ? `“${headerMenu.label}”` : 'No menu' }}<template v-if="headerDoc"> · {{ HEADER_STYLE_LABELS[headerDoc.style] }}</template>
                · Top strip {{ stripDoc?.enabled ? 'on' : 'off' }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <BuilderStatusBadge :state="header.state" :has-unpublished-changes="header.hasUnpublishedChanges" />
              <span v-if="strip" class="inline-flex items-center gap-1.5">Strip <BuilderStatusBadge :state="strip.state" :has-unpublished-changes="strip.hasUnpublishedChanges" /></span>
              <span class="inline-flex items-center gap-1"><UiIcon name="clock" :size="13" /> {{ timeAgo(header.updatedAt) }}</span>
            </div>
          </div>
        </UiCard>
      </section>

      <!-- Menus -->
      <section>
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Menus</h2>
        <UiCardGrid>
          <UiCard v-for="m in menus" :key="m.id" :to="`/site-parts/${m.id}`">
            <div class="flex items-start justify-between gap-3">
              <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"><UiIcon name="list" /></span>
              <BuilderStatusBadge :state="m.state" :has-unpublished-changes="m.hasUnpublishedChanges" />
            </div>
            <h3 class="mt-4 mb-0 text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">{{ m.label }}</h3>
            <p class="mt-0.5 mb-0 text-xs text-gray-500 dark:text-gray-400">{{ menuLabels(m.id).length }} items<template v-if="subCount(m.id)">, {{ subCount(m.id) }} sub-items</template></p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <span v-for="label in menuLabels(m.id).slice(0, 5)" :key="label" class="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">{{ label }}</span>
              <span v-if="menuLabels(m.id).length > 5" class="px-1 text-xs text-gray-500">+{{ menuLabels(m.id).length - 5 }}</span>
            </div>
            <div class="mt-auto flex flex-wrap gap-1.5 pt-4">
              <span v-for="u in usedIn(m.key)" :key="u" class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"><UiIcon name="check" :size="12" /> {{ u }}</span>
              <span v-if="!usedIn(m.key).length" class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">Not used yet</span>
            </div>
          </UiCard>
          <UiCard v-if="canEdit" tone="muted" class="cursor-pointer items-center justify-center text-center" @click="showNewMenu = true">
            <span class="grid size-10 place-items-center rounded-full bg-white text-gray-500 shadow-sm dark:bg-gray-800"><UiIcon name="plus" /></span>
            <p class="mt-3 mb-0 text-sm font-medium text-gray-700 dark:text-gray-300">New menu</p>
            <p class="m-0 text-xs text-gray-500 dark:text-gray-400">For example, footer links or a campaign menu</p>
          </UiCard>
        </UiCardGrid>
      </section>

      <!-- Bottom of every page -->
      <section v-if="footer">
        <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bottom of every page</h2>
        <UiCard :to="`/site-parts/${footer.id}`">
          <div class="flex flex-wrap items-start gap-4">
            <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"><UiIcon name="footer" /></span>
            <div class="min-w-0 flex-1">
              <h3 class="m-0 text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">Footer</h3>
              <p class="mt-0.5 mb-0 text-sm text-gray-600 dark:text-gray-400">
                {{ footerDoc?.appearance === 'dark' ? 'Dark' : 'Light' }}
                <template v-if="footerDoc?.contact.email"> · {{ footerDoc.contact.email }}</template>
                <template v-if="footerDoc?.social.length"> · {{ footerDoc.social.length }} social links</template>
              </p>
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <BuilderStatusBadge :state="footer.state" :has-unpublished-changes="footer.hasUnpublishedChanges" />
              <span class="inline-flex items-center gap-1"><UiIcon name="clock" :size="13" /> {{ timeAgo(footer.updatedAt) }}</span>
            </div>
          </div>
        </UiCard>
      </section>
    </div>

    <FwbModal v-if="showNewMenu" @close="showNewMenu = false">
      <template #header>New menu</template>
      <template #body>
        <form @submit.prevent="createMenu">
          <FwbInput v-model="newMenuLabel" label="Name" placeholder="Footer links" required />
          <p class="mt-2 mb-0 text-sm text-gray-500 dark:text-gray-400">Pick it on the Header or the Footer once it has links. It isn’t live until it’s approved.</p>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <FwbButton color="light" @click="showNewMenu = false">Cancel</FwbButton>
          <FwbButton :disabled="creating || !newMenuLabel.trim()" @click="createMenu">{{ creating ? 'Adding…' : 'Add menu' }}</FwbButton>
        </div>
      </template>
    </FwbModal>
  </div>
</template>
