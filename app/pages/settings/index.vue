<script setup lang="ts">
definePageMeta({ layout: 'builder' })

const sections = [
  { to: '/settings/ai', label: 'AI', note: 'Provider, key, caps, and a test call.', ready: true },
  { to: '', label: 'General', note: "Site name and domain aren't on this screen yet.", ready: false },
  { to: '', label: 'Workflow', note: "Self-approval isn't on this screen yet.", ready: false },
  { to: '', label: 'Integrations', note: 'Cloudflare and email settings will live here. The assistant key is under AI.', ready: false },
]
</script>

<template>
  <div class="p-6">
    <h1 class="mb-2 text-2xl font-semibold text-gray-900">Settings</h1>
    <p class="mb-6 max-w-xl text-gray-600">Site-wide options. Other sections will appear here as they are built.</p>
    <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
      <li v-for="section in sections" :key="section.label">
        <NuxtLink
          v-if="section.ready"
          :to="section.to"
          class="block rounded-lg border border-gray-200 bg-white p-4 no-underline hover:border-gray-300"
        >
          <h2 class="m-0 text-base font-semibold text-gray-900">{{ section.label }}</h2>
          <p class="mt-1 mb-0 text-sm text-gray-600">{{ section.note }}</p>
        </NuxtLink>
        <div v-else class="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4">
          <h2 class="m-0 text-base font-semibold text-gray-700">{{ section.label }}</h2>
          <p class="mt-1 mb-0 text-sm text-gray-500">{{ section.note }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>
