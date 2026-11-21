<script setup lang="ts">
import type { IconName } from './Icon.vue'
// A titled group of fields in an editor panel. With `toggle`, the header carries an on/off switch and the body only
// shows while it is on.
const props = defineProps<{ title: string; description?: string; icon?: IconName; toggle?: boolean; modelValue?: boolean; toggleLabel?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const open = computed(() => !props.toggle || !!props.modelValue)
const id = useId()
</script>

<template>
  <section class="rounded-xl border border-gray-200/90 bg-white dark:border-gray-800 dark:bg-gray-900" :aria-labelledby="id">
    <header class="flex items-start gap-3 px-4 py-3.5" :class="open ? 'border-b border-gray-100 dark:border-gray-800' : ''">
      <span v-if="icon" class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><UiIcon :name="icon" :size="18" /></span>
      <div class="min-w-0 flex-1">
        <h3 :id="id" class="m-0 text-sm font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
        <p v-if="description" class="mt-0.5 mb-0 text-xs leading-5 text-gray-600 dark:text-gray-400">{{ description }}</p>
      </div>
      <label v-if="toggle" class="relative mt-1 inline-flex shrink-0 cursor-pointer items-center" :class="disabled ? 'pointer-events-none opacity-50' : ''">
        <input type="checkbox" class="peer sr-only" role="switch" :checked="!!modelValue" :disabled="disabled" :aria-label="toggleLabel ?? `Show ${title.toLowerCase()}`" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
        <span class="h-6 w-11 rounded-full bg-gray-200 transition peer-checked:bg-blue-600 peer-focus-visible:ring-4 peer-focus-visible:ring-blue-300 dark:bg-gray-700" />
        <span class="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </label>
    </header>
    <div v-if="open && $slots.default" class="space-y-4 px-4 py-4"><slot /></div>
  </section>
</template>
