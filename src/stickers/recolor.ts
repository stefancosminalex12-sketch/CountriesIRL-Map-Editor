/**
 * Recolouring a sticker: its main colour swapped for another, everything else left alone.
 *
 * The image is drawn onto a canvas and its *dominant* colour found — the hue most of its
 * saturated pixels share, the blue of a blue face. Every pixel near that hue is moved to the
 * target: the hue replaced, and saturation and lightness shifted by the difference between the
 * dominant colour and the target, so the shading — the highlight, the darker rim — survives at
 * the new colour. Pixels of other hues (a red rose, white gloves, a black outline) are untouched,
 * which is what makes a blue face with a red rose come out a green face with a red rose.
 *
 * Works on any image the browser can draw: uploads, built-in faces, the icon catalogue. The
 * result is a PNG at most {@link MAX_EDGE} pixels on its longest edge.
 */
import { MAX_EDGE } from './stickerLibrary'

/** How far from the dominant hue a pixel may be and still be recoloured, in turns (≈ 55°). */
const HUE_WINDOW = 0.15
/** Below this saturation a pixel is a grey — a white glove, a black outline — and is kept. */
const MIN_SATURATION = 0.18

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [f(0), f(8), f(4)]
}

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw
  const n = Number.parseInt(full, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Circular distance between two hues, in turns. */
const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1
  return d > 0.5 ? 1 - d : d
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not draw this sticker'))
    image.src = src
  })
}

/** The colour most of an image's saturated pixels share, as HSL, or null for a grey image. */
function dominant(data: Uint8ClampedArray): { h: number; s: number; l: number } | null {
  const BINS = 36
  const weight = new Float64Array(BINS)
  const sumS = new Float64Array(BINS)
  const sumL = new Float64Array(BINS)
  const sumX = new Float64Array(BINS)
  const sumY = new Float64Array(BINS)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    if (s < MIN_SATURATION || l < 0.08 || l > 0.92) continue
    const bin = Math.min(BINS - 1, Math.floor(h * BINS))
    weight[bin] += s
    sumS[bin] += s * s
    sumL[bin] += l * s
    sumX[bin] += Math.cos(h * 2 * Math.PI) * s
    sumY[bin] += Math.sin(h * 2 * Math.PI) * s
  }
  // The heaviest bin with its neighbours, so a hue on a bin edge is not split in two.
  let best = -1
  let bestWeight = 0
  for (let b = 0; b < BINS; b++) {
    const w = weight[b] + weight[(b + 1) % BINS] + weight[(b + BINS - 1) % BINS]
    if (w > bestWeight) {
      bestWeight = w
      best = b
    }
  }
  if (best < 0 || bestWeight === 0) return null
  let w = 0
  let s = 0
  let l = 0
  let x = 0
  let y = 0
  for (const b of [best - 1, best, best + 1].map((v) => (v + BINS) % BINS)) {
    w += weight[b]
    s += sumS[b]
    l += sumL[b]
    x += sumX[b]
    y += sumY[b]
  }
  const h = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1
  return { h, s: s / w, l: l / w }
}

/**
 * The sticker at `src` with its main colour changed to `target` (`#rrggbb`), as a PNG data URI.
 *
 * An image with no main colour — all greys — is tinted as a whole instead, so a white or black
 * sticker can still be given a colour.
 */
export async function recolorSticker(src: string, target: string): Promise<string> {
  const image = await loadImage(src)
  const width = image.naturalWidth || MAX_EDGE
  const height = image.naturalHeight || MAX_EDGE
  const scale = MAX_EDGE / Math.max(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser cannot recolour images')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data

  const [th, ts, tl] = rgbToHsl(...hexToRgb(target))
  const from = dominant(data)

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    let next: [number, number, number]
    if (from) {
      if (s < MIN_SATURATION || hueDistance(h, from.h) > HUE_WINDOW) continue
      // Shading kept: each pixel keeps its offset from the dominant colour, around the target.
      const ns = from.s > 0 ? clamp01(s * (ts / from.s)) : ts
      const nl = clamp01(l + (tl - from.l) * (1 - Math.abs(l - from.l)))
      next = hslToRgb(th, ns, nl)
    } else {
      // A grey image: tint it, keeping its light and dark.
      next = hslToRgb(th, ts * 0.85, clamp01(l * 0.6 + tl * 0.4))
    }
    data[i] = next[0]
    data[i + 1] = next[1]
    data[i + 2] = next[2]
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
