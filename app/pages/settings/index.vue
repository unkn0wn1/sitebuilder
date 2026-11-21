<script setup lang="ts">
import { can } from '#shared/roles'
import { SETTINGS_AREAS } from '../../utils/settings-areas'

definePageMeta({ layout: 'builder' })

const { user } = useSession()
const sections = computed(() => SETTINGS_AREAS.filter((s) => user.value && can(user.value, s.need)))
</script>

<template>
  <div class="sb-page">
    <UiPageHeader title="Settings" description="Site-wide options. Each area saves on its own screen." />
    <UiCardGrid>
      <UiCard v-for="section in sections" :key="section.to" :to="section.to">
        <span class="grid size-10 place-items-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><UiIcon :name="section.icon" /></span>
        <h2 class="mt-4 mb-0 text-base font-semibold text-gray-900 group-hover:text-blue-700 dark:text-white dark:group-hover:text-blue-300">{{ section.label }}</h2>
        <p class="mt-1 mb-0 text-sm text-gray-600 dark:text-gray-400">{{ section.note }}</p>
      </UiCard>
    </UiCardGrid>
  </div>
</template>
