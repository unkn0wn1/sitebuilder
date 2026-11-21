<script setup lang="ts">
import { can } from '#shared/roles'
import { SETTINGS_AREAS } from '../../utils/settings-areas'

const route = useRoute()
const { user } = useSession()
const sections = computed(() => SETTINGS_AREAS.filter((s) => user.value && can(user.value, s.need)))
const active = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <div class="mb-8">
    <NuxtLink to="/settings" class="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 no-underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
      <UiIcon name="back" :size="14" /> Settings
    </NuxtLink>
    <div class="[&_h1]:tracking-tight"><slot name="title" /></div>
    <nav aria-label="Settings" class="mt-4 flex flex-wrap gap-1.5 border-b border-gray-200 pb-4 dark:border-gray-800">
      <NuxtLink
        v-for="section in sections"
        :key="section.to"
        :to="section.to"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium no-underline transition"
        :class="active(section.to) ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'"
        :aria-current="active(section.to) ? 'page' : undefined"
      >
        <UiIcon :name="section.icon" :size="14" /> {{ section.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
