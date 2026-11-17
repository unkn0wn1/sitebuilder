<script setup lang="ts">
import { can, type Action } from '#shared/roles'

definePageMeta({ layout: 'builder' })

const { user } = useSession()

const all = [
  { to: '/settings/general', label: 'General', note: 'Site name, domain, and how page titles are written.', need: 'settings.manage' as Action },
  { to: '/settings/workflow', label: 'Workflow', note: 'Whether someone can approve their own changes.', need: 'settings.manage' as Action },
  { to: '/settings/integrations', label: 'Integrations', note: 'Cloudflare token and Google Workspace email.', need: 'settings.manage' as Action },
  { to: '/settings/ai', label: 'AI', note: 'Provider, key, caps, and a test call.', need: 'settings.manage' as Action },
  { to: '/settings/tracking', label: 'Tracking', note: 'Google Analytics, Tag Manager, Plausible and Cookiebot.', need: 'settings.manage' as Action },
  { to: '/settings/seo', label: 'SEO and redirects', note: 'Indexing, the default social image, and address redirects.', need: 'settings.manage' as Action },
  { to: '/settings/security', label: 'Security', note: 'Which embed providers pages may use.', need: 'settings.manage' as Action },
  { to: '/settings/users', label: 'Users', note: 'Invite people, change roles, or deactivate an account.', need: 'users.manage' as Action },
  { to: '/settings/publishing', label: 'Publishing', note: 'Recent releases, activity, and emergency rollback.', need: 'release.read' as Action },
  { to: '/settings/backups', label: 'Backups', note: 'Stored backups and a button to make one now.', need: 'backups.manage' as Action },
  { to: '/settings/system', label: 'System', note: 'Version, disk, queue and recent job failures.', need: 'system.read' as Action },
]

const sections = computed(() => all.filter((s) => user.value && can(user.value, s.need)))
</script>

<template>
  <div class="p-6">
    <h1 class="mb-2 text-2xl font-semibold text-gray-900">Settings</h1>
    <p class="mb-6 max-w-xl text-gray-600">Site-wide options. Each section saves on its own screen.</p>
    <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
      <li v-for="section in sections" :key="section.label">
        <NuxtLink :to="section.to" class="block rounded-lg border border-gray-200 bg-white p-4 no-underline hover:border-gray-300">
          <h2 class="m-0 text-base font-semibold text-gray-900">{{ section.label }}</h2>
          <p class="mt-1 mb-0 text-sm text-gray-600">{{ section.note }}</p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
