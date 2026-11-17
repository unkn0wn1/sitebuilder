<script setup lang="ts">
import { can } from '#shared/roles'
import { api } from '../../utils/api'

defineProps<{ editor?: boolean }>()

const route = useRoute()
const { user, site, logout } = useSession()
const pendingCount = ref(0)

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
watch(() => route.path, (path) => {
  if (path.startsWith('/approvals')) void loadPendingCount()
})

const items = computed(() => {
  const actor = user.value
  if (!actor) return []
  const all = [
    { to: '/pages', label: 'Pages', show: can(actor, 'page.read') },
    { to: '/site-parts', label: 'Site parts', show: can(actor, 'sitePart.edit') },
    { to: '/media', label: 'Media', show: can(actor, 'media.upload') },
    { to: '/forms', label: 'Forms and embeds', show: can(actor, 'embed.manage') },
    { to: '/approvals', label: 'Approvals', show: can(actor, 'review.read') },
    { to: '/brand', label: 'Brand and Design', show: can(actor, 'brand.edit') },
    { to: '/templates', label: 'Page types', show: can(actor, 'template.edit') },
    { to: '/settings', label: 'Settings', show: can(actor, 'settings.manage') || actor.isOperator },
  ]
  return all.filter((i) => i.show)
})

function active(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}

const liveHref = computed(() => {
  const domain = site.value?.primaryDomain
  return domain ? `https://${domain}` : null
})
</script>

<template>
  <div class="sb-builder" :class="{ 'is-editor': editor }">
    <header class="sb-topbar">
      <NuxtLink to="/pages" class="font-semibold text-gray-900 dark:text-gray-100 no-underline">sitebuilder</NuxtLink>
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span class="truncate text-gray-800 dark:text-gray-200">{{ site?.name ?? 'Site' }}</span>
        <a v-if="liveHref" :href="liveHref" target="_blank" rel="noreferrer" class="text-sm text-blue-700 dark:text-blue-400 no-underline hover:underline">View live</a>
      </div>
      <div class="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <BuilderThemeToggle />
        <span class="hidden sm:inline">{{ user?.name }}</span>
        <FwbButton color="alternative" size="sm" @click="logout">Sign out</FwbButton>
      </div>
    </header>
    <nav v-if="!editor" class="sb-nav" aria-label="Builder">
      <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="item in items" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="block rounded-md px-3 py-2 text-sm no-underline"
            :class="active(item.to) ? 'bg-white dark:bg-gray-800 font-semibold text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'"
          >
            {{ item.label }}
            <span v-if="item.to === '/approvals' && pendingCount" class="ml-1 rounded-full bg-blue-700 px-1.5 text-xs font-medium text-white">{{ pendingCount }}</span>
          </NuxtLink>
        </li>
      </ul>
    </nav>
    <div v-else class="border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" aria-hidden="true" />
    <main class="sb-main">
      <slot />
    </main>
  </div>
</template>
