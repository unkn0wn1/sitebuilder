<script setup lang="ts">
// Everything at the top of every page, in one place (docs/19-admin-redesign.md): the top strip (the banner part),
// which menu and its look (the only place the menu look is chosen), the button, the small link and the appearance.
import { HEADER_STYLE_HELP, HEADER_STYLE_LABELS, HEADER_STYLES, type BannerDoc, type HeaderDoc, type HeaderStyle, type LinkTarget } from '#shared/site-parts'
import type { PageOption, SitePartListItem } from '../../utils/site-parts'
import BannerEditor from './BannerEditor.vue'
import LinkTargetField from './LinkTargetField.vue'

const props = defineProps<{
  modelValue: HeaderDoc
  pages: PageOption[]
  menus: SitePartListItem[]
  /** The top strip (banner part), or null when the site has none yet. */
  strip: BannerDoc | null
  canEdit?: boolean
  addingStrip?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [HeaderDoc]; 'update:strip': [BannerDoc]; 'add-strip': [] }>()

const menuParts = computed(() => props.menus.filter((m) => m.kind === 'menu'))
const currentMenu = computed(() => menuParts.value.find((m) => m.key === props.modelValue.menuKey) ?? null)

function patch(update: Partial<HeaderDoc>) {
  emit('update:modelValue', { ...props.modelValue, ...update })
}
function patchStrip(update: Partial<BannerDoc>) {
  if (props.strip) emit('update:strip', { ...props.strip, ...update })
}

function setCta(on: boolean) {
  if (on) {
    const first = props.pages[0]
    patch({ cta: { label: 'Donate', target: first ? { type: 'page', pageId: first.id } : { type: 'url', url: 'https://' } } })
  } else patch({ cta: null })
}
function setCtaLabel(label: string) {
  if (props.modelValue.cta) patch({ cta: { ...props.modelValue.cta, label } })
}
function setCtaTarget(target: LinkTarget) {
  if (props.modelValue.cta) patch({ cta: { ...props.modelValue.cta, target } })
}
</script>

<template>
  <div class="space-y-4" :class="canEdit === false ? 'pointer-events-none opacity-70' : ''">
    <!-- Top strip -->
    <UiSection
      v-if="strip"
      title="Top strip"
      description="A thin line above the header on every page, for something urgent or always useful."
      icon="strip"
      toggle
      toggle-label="Show the top strip"
      :model-value="strip.enabled"
      data-section="strip"
      @update:model-value="patchStrip({ enabled: $event })"
    >
      <BannerEditor :model-value="strip" :pages="pages" @update:model-value="emit('update:strip', $event)" />
    </UiSection>
    <UiSection v-else title="Top strip" description="A thin line above the header on every page, for example “Report an ill or injured animal”." icon="strip" data-section="strip">
      <FwbButton size="sm" color="light" :disabled="addingStrip" @click="emit('add-strip')">
        <span class="inline-flex items-center gap-1.5"><UiIcon name="plus" :size="14" /> {{ addingStrip ? 'Adding…' : 'Add a top strip' }}</span>
      </FwbButton>
    </UiSection>

    <!-- Menu and its look: the one place to choose either -->
    <UiSection title="Menu" description="Which menu the header shows, and how it looks." icon="list" data-section="menu">
      <div>
        <FwbSelect
          :model-value="modelValue.menuKey"
          :options="menuParts.length ? menuParts.map((m) => ({ name: m.label, value: m.key })) : [{ name: 'No menus yet', value: modelValue.menuKey }]"
          label="Menu"
          @update:model-value="patch({ menuKey: String($event) })"
        />
        <NuxtLink v-if="currentMenu" :to="`/site-parts/${currentMenu.id}`" class="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 no-underline hover:underline dark:text-blue-300">
          <UiIcon name="pencil" :size="13" /> Edit the links in “{{ currentMenu.label }}”
        </NuxtLink>
      </div>
      <fieldset>
        <legend class="mb-2 text-sm font-medium text-gray-900 dark:text-white">Menu look</legend>
        <div class="grid grid-cols-2 gap-2" data-testid="menu-look">
          <label
            v-for="style in HEADER_STYLES"
            :key="style"
            class="group flex cursor-pointer flex-col gap-2 rounded-lg border border-gray-200 p-2.5 text-sm has-[:checked]:border-blue-600 has-[:checked]:ring-1 has-[:checked]:ring-blue-600 dark:border-gray-700"
          >
            <input type="radio" class="sr-only" name="menu-look" :value="style" :checked="modelValue.style === style" @change="patch({ style: style as HeaderStyle })" />
            <!-- A tiny drawing of each look -->
            <span class="flex h-10 items-center gap-1 rounded-md bg-gray-100 px-2 dark:bg-gray-800" :class="style === 'centred' ? 'flex-col justify-center' : ''" aria-hidden="true">
              <span class="h-2 w-5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-500" />
              <template v-if="style === 'hamburger'"><span class="ml-auto flex flex-col gap-0.5"><span v-for="n in 3" :key="n" class="h-0.5 w-3.5 bg-gray-500" /></span></template>
              <span v-else class="flex gap-1" :class="style === 'centred' ? '' : 'ml-auto'"><span v-for="n in 3" :key="n" class="h-1 w-3 rounded-sm bg-gray-400 dark:bg-gray-500" /></span>
              <span v-if="style === 'mega'" class="h-4 w-4 rounded-sm border border-gray-400 bg-white dark:bg-gray-700" />
            </span>
            <span class="font-medium text-gray-900 dark:text-white">{{ HEADER_STYLE_LABELS[style] }}</span>
            <span class="-mt-1 text-xs leading-4 text-gray-500 dark:text-gray-400">{{ HEADER_STYLE_HELP[style] }}</span>
          </label>
        </div>
      </fieldset>
    </UiSection>

    <UiSection title="Button" description="One clear action at the right of the header." icon="link" toggle toggle-label="Show a button in the header" :model-value="!!modelValue.cta" @update:model-value="setCta">
      <template v-if="modelValue.cta">
        <FwbInput :model-value="modelValue.cta.label" label="Button text" @update:model-value="setCtaLabel(String($event))" />
        <LinkTargetField :model-value="modelValue.cta.target" :pages="pages" label="Button goes to" @update:model-value="setCtaTarget" />
      </template>
    </UiSection>

    <UiSection title="Appearance" icon="sun">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-gray-900 dark:text-white">Background</span>
        <UiSegmented
          :model-value="modelValue.appearance ?? 'light'"
          :options="[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]"
          label="Header background"
          @update:model-value="patch({ appearance: $event === 'dark' ? 'dark' : 'light' })"
        />
      </div>
    </UiSection>
  </div>
</template>
