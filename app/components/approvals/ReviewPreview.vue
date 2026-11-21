<script setup lang="ts">
// The approval preview. A page is drawn by the publish renderer (RenderedPage), with added and changed sections
// outlined. A site part is drawn on the live home page with the submitted version swapped in.
import type { PageDoc } from '#shared/page'
import type { PageDiff } from '#shared/diff'
import type { SitePartDoc, SitePartKind, MenuDoc } from '#shared/site-parts'
import type { Device } from '../../utils/page-editor'
import RenderedPage, { type BlockMark } from '../preview/RenderedPage.vue'
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
  pageId?: string
  path?: string
  /** The site part under review. */
  partId?: string
}>()
const partPayload = computed(() => (props.kind === 'site_part' && props.partId ? { parts: [{ partId: props.partId, doc: props.doc }] } : undefined))

const pageDoc = computed(() => (props.kind === 'page' ? (props.doc as PageDoc) : null))
const rendered = ref<InstanceType<typeof RenderedPage> | null>(null)

const marks = computed(() => {
  const out: Record<string, BlockMark> = {}
  if (!props.showChanges) return out
  for (const change of props.diff?.blocks ?? []) {
    if (change.kind === 'added') out[change.blockId] = 'added'
    else if (change.kind === 'changed' || change.kind === 'moved') out[change.blockId] = 'changed'
  }
  return out
})

const removed = computed(() => (props.showChanges ? (props.diff?.blocks ?? []).filter((c) => c.kind === 'removed') : []))

/** Scroll the preview to a section (from the list of changes). */
function scrollToBlock(id: string) {
  rendered.value?.scrollToBlock(id)
}
defineExpose({ scrollToBlock })
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
    <template v-if="kind === 'page' && pageDoc">
      <p v-if="!pageDoc.blocks.length" class="m-auto p-16 text-center text-gray-500 dark:text-gray-400">This page has no sections yet.</p>
      <RenderedPage v-else ref="rendered" :doc="pageDoc" :device="device" :page-id="pageId" :path="path" :marks="marks" :gutter="32" :selectable="false">
        <template #below>
          <div v-if="removed.length" class="mx-auto mb-6 max-w-3xl px-6">
            <p v-for="change in removed" :key="change.blockId" class="m-0 mt-1 border-l-4 border-red-500 bg-red-50 px-4 py-2 text-sm text-red-900">Removed: {{ change.type }}</p>
          </div>
        </template>
      </RenderedPage>
    </template>
    <RenderedPage v-else-if="partPayload" endpoint="/preview/site-part" :payload="partPayload" :device="device" :gutter="32" :selectable="false" />
  </div>
</template>
