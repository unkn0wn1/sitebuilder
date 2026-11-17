<script setup lang="ts">
import { ApiError } from '../utils/api'

definePageMeta({ layout: 'default' })

const { user, login } = useSession()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const route = useRoute()

onMounted(async () => {
  if (user.value) await navigateTo('/pages')
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await login(email.value.trim(), password.value)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "That email and password don't match."
    busy.value = false
    return
  }
  try {
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/pages'
    await navigateTo(next)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Signed in, but the next screen failed to open.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-6">
    <div class="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm">
      <div class="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 class="mb-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
          <p class="m-0 text-gray-600 dark:text-gray-400">Use your sitebuilder account.</p>
        </div>
        <BuilderThemeToggle />
      </div>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <FwbInput v-model="email" type="email" autocomplete="username" label="Email" required />
        <FwbInput v-model="password" type="password" autocomplete="current-password" label="Password" required />
        <FwbAlert v-if="error" type="danger">{{ error }}</FwbAlert>
        <FwbButton type="submit" class="w-full" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</FwbButton>
      </form>
    </div>
  </div>
</template>
