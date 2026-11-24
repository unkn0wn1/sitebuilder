<script setup lang="ts">
// The builder shell (docs/19-admin-redesign.md): a fixed sidebar on large screens, a sheet on phones, and an icon rail
// for the full-width editors.
import { can } from '#shared/roles'
import { api } from '../../utils/api'
import type { IconName } from '../ui/Icon.vue'

const props = defineProps<{ editor?: boolean }>()

const route = useRoute()
const { user, site, logout } = useSession()
const pendingCount = ref(0)
const sheetOpen = ref(false)

async function loadPendingCount() {
  const actor = user.value
  if (!actor || !can(actor, 'review.read')) return
  try {
    const data = await api<{ items: { id: string }[] }>('/reviews?state=pending')
    pendingCount.value = data.items.length
  } catch {
    pendingCount.value = 0
  }
}

onMounted(loadPendingCount)
watch(
  () => route.path,
  (path) => {
    sheetOpen.value = false
    if (path.startsWith('/approvals')) void loadPendingCount()
  },
)

type NavItem = { to: string; label: string; icon: IconName; show: boolean }
const groups = computed(() => {
  const actor = user.value
  if (!actor) return []
  const all: { label: string; items: NavItem[] }[] = [
    {
      label: 'Content',
      items: [
        { to: '/pages', label: 'Pages', icon: 'pages', show: can(actor, 'page.read') },
        { to: '/site-parts', label: 'Site parts', icon: 'parts', show: can(actor, 'sitePart.edit') },
        { to: '/media', label: 'Media', icon: 'media', show: can(actor, 'media.upload') },
        { to: '/forms', label: 'Forms and embeds', icon: 'forms', show: can(actor, 'embed.manage') },
      ],
    },
    { label: 'Review', items: [{ to: '/approvals', label: 'Approvals', icon: 'approvals', show: can(actor, 'review.read') }] },
    {
      label: 'Design and setup',
      items: [
        { to: '/brand', label: 'Brand and Design', icon: 'brand', show: can(actor, 'brand.edit') },
        { to: '/templates', label: 'Page types', icon: 'templates', show: can(actor, 'template.edit') },
        { to: '/settings', label: 'Settings', icon: 'settings', show: can(actor, 'settings.manage') || actor.isOperator },
      ],
    },
  ]
  return all.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length)
})

function active(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

const liveHref = computed(() => {
  const domain = site.value?.primaryDomain
  return domain ? `https://${domain}` : null
})
const initials = computed(() =>
  (user.value?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
)
const rail = computed(() => !!props.editor)
</script>

<template>
  <div class="sb-shell" :class="rail ? 'lg:pl-16' : 'lg:pl-60'">
    <!-- Phone top bar -->
    <header class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/90 px-3 backdrop-blur lg:hidden dark:border-gray-800 dark:bg-gray-900/90">
      <button type="button" class="grid size-9 place-items-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" aria-label="Open the menu" :aria-expanded="sheetOpen" @click="sheetOpen = true">
        <UiIcon name="menu" />
      </button>
      <span class="truncate font-semibold text-gray-900 dark:text-white">{{ site?.name ?? 'Site' }}</span>
      <span v-if="pendingCount" class="ml-auto rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">{{ pendingCount }} waiting</span>
    </header>

    <!-- Sheet backdrop (phones) -->
    <div v-if="sheetOpen" class="fixed inset-0 z-40 bg-gray-950/40 backdrop-blur-[1px] lg:hidden" @click="sheetOpen = false" />

    <!-- Sidebar: fixed on large screens, a sheet on phones, an icon rail in the editors -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex flex-col border-r border-gray-200 bg-white transition-transform dark:border-gray-800 dark:bg-gray-900"
      :class="[sheetOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0', rail ? 'w-72 lg:w-16' : 'w-72 lg:w-60']"
      aria-label="Sidebar"
    >
      <div class="flex items-center gap-3 px-4 pt-4 pb-3" :class="rail ? 'lg:justify-center lg:px-2' : ''">
        <NuxtLink to="/pages" class="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-900 text-sm font-bold text-white no-underline dark:bg-white dark:text-gray-900" :title="site?.name ?? 'Skewstone'">
          {{ (site?.name ?? 'S').slice(0, 1) }}
        </NuxtLink>
        <div class="min-w-0 flex-1" :class="rail ? 'lg:hidden' : ''">
          <p class="m-0 truncate text-sm font-semibold text-gray-900 dark:text-white">{{ site?.name ?? 'Site' }}</p>
          <a v-if="liveHref" :href="liveHref" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-xs text-gray-500 no-underline hover:text-blue-700 dark:text-gray-400 dark:hover:text-blue-300">
            View live site <UiIcon name="external" :size="12" />
          </a>
        </div>
        <button type="button" class="grid size-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 lg:hidden dark:hover:bg-gray-800" aria-label="Close the menu" @click="sheetOpen = false">
          <UiIcon name="close" :size="18" />
        </button>
      </div>

      <nav aria-label="Builder" class="flex-1 px-3 pb-3" :class="rail ? 'lg:px-2' : ''">
        <div v-for="group in groups" :key="group.label" class="mt-4 first:mt-1">
          <p class="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500" :class="rail ? 'lg:sr-only' : ''">{{ group.label }}</p>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <li v-for="item in group.items" :key="item.to">
              <NuxtLink
                :to="item.to"
                :title="item.label"
                class="relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-underline transition"
                :class="[
                  active(item.to) ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
                  rail ? 'lg:justify-center lg:px-0' : '',
                ]"
                :aria-current="active(item.to) ? 'page' : undefined"
              >
                <UiIcon :name="item.icon" />
                <span :class="rail ? 'lg:sr-only' : ''">{{ item.label }}</span>
                <span
                  v-if="item.to === '/approvals' && pendingCount"
                  class="ml-auto rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold leading-5 text-white"
                  :class="rail ? 'lg:absolute lg:-right-0.5 lg:-top-0.5 lg:ml-0' : ''"
                >{{ pendingCount }}</span>
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>

      <div class="border-t border-gray-100 p-3 dark:border-gray-800">
        <div class="flex items-center gap-3" :class="rail ? 'lg:flex-col lg:gap-2' : ''">
          <span class="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white" :title="user?.name">{{ initials }}</span>
          <div class="min-w-0 flex-1" :class="rail ? 'lg:hidden' : ''">
            <p class="m-0 truncate text-sm font-medium text-gray-900 dark:text-white">{{ user?.name }}</p>
            <p class="m-0 truncate text-xs capitalize text-gray-500 dark:text-gray-400">{{ user?.role }}</p>
          </div>
          <button type="button" class="grid size-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white" title="Sign out" aria-label="Sign out" @click="logout">
            <UiIcon name="logout" :size="18" />
          </button>
        </div>
        <div class="mt-3" :class="rail ? 'lg:hidden' : ''"><BuilderThemeToggle /></div>
      </div>
    </aside>

    <main class="min-w-0">
      <slot />
    </main>
  </div>
</template>
