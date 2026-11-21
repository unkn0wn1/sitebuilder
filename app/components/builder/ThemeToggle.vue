<script setup lang="ts">
import type { ThemePreference } from '../../utils/theme'

const { preference, setPreference } = useColorMode()
const options: { value: ThemePreference; label: string; icon: 'desktop' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'System', icon: 'desktop' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]
</script>

<template>
  <UiSegmented :model-value="preference" :options="options" label="Colour theme" compact @update:model-value="setPreference" />
</template>
