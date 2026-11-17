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
  usedOn: { pageId: string; title: string; inDraft: boolean; live: boolean }[]
}

export function mediaFileUrl(id: string, name: string) {
  return `/api/v1/media/${id}/files/${encodeURIComponent(name)}`
}
