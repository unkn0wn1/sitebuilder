<script setup lang="ts">
import type { PageDoc } from '#shared/page'
import type { PageDiff } from '#shared/diff'
import type { SitePartDoc, SitePartKind, MenuDoc } from '#shared/site-parts'
import { canvasScale } from '../../utils/format'
import { DEVICE_WIDTHS, type Device } from '../../utils/page-editor'
import { CANVAS_SCOPE, SCOPED_THEME_CSS } from '../../utils/theme-css'
import SectionView from '../editor/SectionView.vue'
import PartPreview from '../site-parts/PartPreview.vue'
import type { PageOption } from '../../utils/site-parts'

const props = defineProps<{
  kind: 'page' | 'site_part'
  sitePartKind?: SitePartKind
  doc: PageDoc | SitePartDoc
  diff?: PageDiff
  showChanges: boolean
  device: Device
  siteName: string
  menus?: Record<string, MenuDoc>
  pages?: PageOption[]
}>()

const host = ref<HTMLElement | null>(null)
const available = ref(800)
const width = computed(() => DEVICE_WIDTHS[props.device])
const scale = computed(() => canvasScale(Math.max(available.value - 32, 160), width.value))

function measure() {
  available.value = host.value?.clientWidth ?? 800
}

onMounted(() => {
  measure()
  const observer = new ResizeObserver(measure)
  if (host.value) observer.observe(host.value)
  onBeforeUnmount(() => observer.disconnect())
})

const pageDoc = computed(() => (props.kind === 'page' ? (props.doc as PageDoc) : null))

const changeById = computed(() => {
  const map = new Map<string, PageDiff['blocks'][number]>()
  for (const change of props.diff?.blocks ?? []) map.set(change.blockId, change)
  return map
})

const removed = computed(() => (props.showChanges ? (props.diff?.blocks ?? []).filter((c) => c.kind === 'removed') : []))

function changeClass(id: string): string {
  if (!props.showChanges) return ''
  const kind = changeById.value.get(id)?.kind
  if (kind === 'added') return 'outline outline-2 outline-offset-[-2px] outline-emerald-500'
  if (kind === 'changed' || kind === 'moved') return 'outline outline-2 outline-offset-[-2px] outline-amber-500'
  return ''
}
</script>

<template>
  <div ref="host" class="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-100">
    <template v-if="kind === 'page' && pageDoc">
      <component :is="'style'">{{ SCOPED_THEME_CSS }}</component>
      <p v-if="scale < 1" class="sticky top-0 z-10 m-0 bg-gray-100/90 px-4 py-1 text-center text-xs text-gray-600">Shown at {{ Math.round(scale * 100) }}%</p>
      <div class="flex justify-center p-4">
        <div
          :class="CANVAS_SCOPE"
          class="origin-top bg-[var(--paper,#fffaf3)] shadow-md"
          :style="{ width: `${width}px`, transform: `scale(${scale})`, marginBottom: scale < 1 ? `${-(1 - scale) * 800}px` : undefined }"
        >
          <p v-if="!pageDoc.blocks.length" class="p-16 text-center text-gray-500">This page has no sections yet.</p>
          <div v-for="(block, index) in pageDoc.blocks" :key="block.id" :id="`block-${block.id}`" :class="changeClass(block.id)">
            <SectionView :block="block" :first-hero="index === 0 && (block.type === 'Hero' || block.type === 'VideoHero')" />
          </div>
          <div v-for="change in removed" :key="change.blockId" class="border-t border-red-200 bg-red-50 px-6 py-3 text-sm text-red-900">
            Removed: {{ change.type }}
          </div>
        </div>
      </div>
    </template>
    <div v-else-if="kind === 'site_part' && sitePartKind" class="p-4">
      <PartPreview
        :kind="sitePartKind"
        :doc="doc as SitePartDoc"
        :site-name="siteName"
        :menus="menus ?? {}"
        :pages="pages ?? []"
        :device="device === 'mobile' ? 'phone' : 'computer'"
      />
    </div>
  </div>
</template>
