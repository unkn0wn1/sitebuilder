import { ref } from 'vue'

export interface MediaItem {
  id: string
  kind: 'image' | 'video' | 'svg'
  filename: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  alt: string | null
  decorative: boolean
  focalX: number | null
  focalY: number | null
  placeholder: string | null
  status: 'processing' | 'ready' | 'failed'
  preview: string | null
  createdAt: string
}

export interface MediaCrop {
  id: string
  ratio: string
  breakpoint: string
  x: number
  y: number
  width: number
  height: number
  renditions: string[]
}

export interface MediaDetails {
  media: MediaItem
  preview: string | null
  renditions: string[]
  crops: MediaCrop[]
  usedOn: { pageId: string; title: string; inDraft: boolean; live: boolean; href?: string }[]
}

export function mediaFileUrl(id: string, name: string) {
  return `/api/v1/media/${id}/files/${encodeURIComponent(name)}`
}

/** Bumped when a crop is approved, so canvas images ask the server again. */
export const mediaVersion = ref(0)

/**
 * A photo for the builder canvas and review previews. The server picks the nearest rendition that exists (and the
 * approved crop for the ratio), so photos narrower than the wanted width and cropped photos both show correctly.
 */
export function canvasImageUrl(id: string, width: number, ratio?: string | null): string {
  const q = new URLSearchParams({ w: String(width) })
  if (ratio) q.set('ratio', ratio)
  if (mediaVersion.value) q.set('v', String(mediaVersion.value))
  return `/api/v1/media/${encodeURIComponent(id)}/view?${q.toString()}`
}
