// Crop geometry for image slots. Used by the media library and the AI crop_media tool.
// Ratios are simple (for example 16:9). Coordinates are in the stored, upright image's pixels.

const COMMON_RATIOS = ['16:9', '4:3', '3:2', '1:1', '4:5', '9:16', '3:4', '2:3', '21:9'] as const

export const RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

export function parseRatio(ratio: string): { w: number; h: number } {
  if (!RATIO_PATTERN.test(ratio)) throw new Error(`Use a ratio like 16:9, not "${ratio}".`)
  const [w, h] = ratio.split(':').map(Number) as [number, number]
  if (!w || !h) throw new Error(`Use a ratio like 16:9, not "${ratio}".`)
  return { w, h }
}

/** Simplify a size to a ratio the crop schema accepts (two digits a side). 1280×853 becomes 3:2. */
export function ratioFromSize(width: number, height: number): string {
  const g = gcd(width, height)
  const w = width / g
  const h = height / g
  if (w <= 99 && h <= 99) return `${w}:${h}`
  return nearestCommonRatio(width / height)
}

export function nearestCommonRatio(value: number): string {
  let best: (typeof COMMON_RATIOS)[number] = '16:9'
  let bestDiff = Infinity
  for (const c of COMMON_RATIOS) {
    const { w, h } = parseRatio(c)
    const d = Math.abs(value - w / h)
    if (d < bestDiff) {
      bestDiff = d
      best = c
    }
  }
  return best
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Largest rectangle of the given ratio that fits in the image, centred on the focal point
 * (or the middle). Pixel sizes are nudged so the ratio stays within 2%.
 */
export function defaultCropRect(
  image: { width: number; height: number; focalX?: number | null; focalY?: number | null },
  ratio: string,
): CropRect {
  const { w: rw, h: rh } = parseRatio(ratio)
  const imgW = image.width
  const imgH = image.height
  const target = rw / rh
  let width: number
  let height: number
  if (imgW / imgH > target) {
    height = imgH
    width = Math.min(imgW, Math.round(height * target))
  } else {
    width = imgW
    height = Math.min(imgH, Math.round(width / target))
  }
  ;({ width, height } = fitRatio(width, height, target, imgW, imgH))
  const fx = image.focalX ?? imgW / 2
  const fy = image.focalY ?? imgH / 2
  const x = clamp(Math.round(fx - width / 2), 0, imgW - width)
  const y = clamp(Math.round(fy - height / 2), 0, imgH - height)
  return { x, y, width, height }
}

function fitRatio(width: number, height: number, target: number, maxW: number, maxH: number): { width: number; height: number } {
  let w = Math.max(16, width)
  let h = Math.max(16, height)
  for (let i = 0; i < 8 && Math.abs(w / h - target) > 0.02; i++) {
    const nextW = Math.min(maxW, Math.max(16, Math.round(h * target)))
    const nextH = Math.min(maxH, Math.max(16, Math.round(w / target)))
    if (Math.abs(nextW / h - target) <= Math.abs(w / nextH - target) && nextW <= maxW) w = nextW
    else h = nextH
  }
  return { width: w, height: h }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** True if the rectangle is inside the image and matches the ratio (2% tolerance). */
export function cropRectError(image: { width: number; height: number }, ratio: string, rect: CropRect): string | null {
  if (rect.width < 16 || rect.height < 16) return 'The crop is too small.'
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > image.width || rect.y + rect.height > image.height) {
    return 'The crop goes outside the image.'
  }
  const { w, h } = parseRatio(ratio)
  if (Math.abs(rect.width / rect.height - w / h) > 0.02) return `The crop isn't ${ratio}.`
  return null
}
