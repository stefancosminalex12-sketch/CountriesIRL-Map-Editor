/**
 * Whether a point on the screen is on a sticker's picture, or on the empty corners of its box.
 *
 * A sticker is an `<image>` (through a `<use>`), and the browser hit-tests an image by its
 * rectangle: the transparent corners round a round face took clicks as well as the face did, so on
 * a sticker made large — France's, reaching down to Marseille — a click on the land beside the face
 * chose the sticker instead of the country. This reads the picture's own transparency and answers
 * for the pixel under the pointer; the map passes a click on a clear pixel to what is beneath.
 *
 * Each picture is read once, small (`GRID` square — plenty to tell ink from clear), placed in its
 * square exactly as the `<symbol>` places it (`xMidYMid meet`), and kept. Until a picture has been
 * read the whole box counts, as it always did.
 */

/** The side of the transparency grid each picture is read into. */
const GRID = 64
/** Alpha at or below this is clear: the soft edge of a picture's antialiasing still counts. */
const CLEAR = 24

const masks = new Map<string, Uint8ClampedArray | 'loading' | 'failed'>()

function read(src: string): void {
  masks.set(src, 'loading')
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = GRID
      canvas.height = GRID
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('no 2d')
      const w = image.naturalWidth || GRID
      const h = image.naturalHeight || GRID
      const scale = Math.min(GRID / w, GRID / h)
      context.drawImage(image, (GRID - w * scale) / 2, (GRID - h * scale) / 2, w * scale, h * scale)
      const pixels = context.getImageData(0, 0, GRID, GRID).data
      const alpha = new Uint8ClampedArray(GRID * GRID)
      for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]
      masks.set(src, alpha)
    } catch {
      masks.set(src, 'failed')
    }
  }
  image.onerror = () => masks.set(src, 'failed')
  image.src = src
}

/** The picture a sticker's `<use>` shows. */
function srcOf(use: Element): string | null {
  const ref = use.getAttribute('href')
  if (!ref?.startsWith('#')) return null
  return document.getElementById(ref.slice(1))?.querySelector('image')?.getAttribute('href') ?? null
}

/**
 * Whether `(clientX, clientY)` is on the picture of the sticker `use` draws. True while the
 * picture is still being read, or could not be, so nothing becomes unclickable.
 */
export function onStickerInk(use: Element, clientX: number, clientY: number): boolean {
  const src = srcOf(use)
  if (!src) return true
  const mask = masks.get(src)
  if (mask === undefined) {
    read(src)
    return true
  }
  if (mask === 'loading' || mask === 'failed') return true
  const box = use.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return true
  const x = Math.floor(((clientX - box.left) / box.width) * GRID)
  const y = Math.floor(((clientY - box.top) / box.height) * GRID)
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false
  return mask[y * GRID + x] > CLEAR
}

/** Reads a sticker's picture ahead of the first click on it. */
export function primeStickerInk(use: Element): void {
  const src = srcOf(use)
  if (src && !masks.has(src)) read(src)
}

/**
 * What is under the point beneath any sticker — the land a click on a sticker's clear corner is
 * really on. `null` when nothing but the map's background is there.
 */
export function beneathStickers(clientX: number, clientY: number, marker: string): Element | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (element.closest(`[${marker}]`)) continue
    return element
  }
  return null
}
