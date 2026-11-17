<script setup lang="ts">
import { can, type Action } from '#shared/roles'

const route = useRoute()
const { user } = useSession()

const all = [
  { to: '/settings/general', label: 'General', need: 'settings.manage' as Action },
  { to: '/settings/workflow', label: 'Workflow', need: 'settings.manage' as Action },
  { to: '/settings/integrations', label: 'Integrations', need: 'settings.manage' as Action },
  { to: '/settings/ai', label: 'AI', need: 'settings.manage' as Action },
  { to: '/settings/tracking', label: 'Tracking', need: 'settings.manage' as Action },
  { to: '/settings/seo', label: 'SEO and redirects', need: 'settings.manage' as Action },
  { to: '/settings/security', label: 'Security', need: 'settings.manage' as Action },
  { to: '/settings/users', label: 'Users', need: 'users.manage' as Action },
  { to: '/settings/publishing', label: 'Publishing', need: 'release.read' as Action },
  { to: '/settings/backups', label: 'Backups', need: 'backups.manage' as Action },
  { to: '/settings/system', label: 'System', need: 'system.read' as Action },
]

const sections = computed(() => all.filter((s) => user.value && can(user.value, s.need)))

function active(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="mb-1 text-sm text-gray-500"><NuxtLink to="/settings" class="text-gray-500 no-underline hover:underline">Settings</NuxtLink></p>
      <slot name="title" />
    </div>
    <nav aria-label="Settings" class="flex flex-wrap gap-1">
      <NuxtLink
        v-for="section in sections"
        :key="section.to"
        :to="section.to"
        class="rounded-md px-3 py-1.5 text-sm no-underline"
        :class="active(section.to) ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'"
      >
        {{ section.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
