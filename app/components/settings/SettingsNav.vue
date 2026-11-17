<script setup lang="ts">
const route = useRoute()

const sections = [
  { to: '/settings/ai', label: 'AI', ready: true },
]

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
