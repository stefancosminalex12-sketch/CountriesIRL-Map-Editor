/**
 * Sticker thumbnails as small pictures rather than live drawings.
 *
 * A face is an SVG with lighting filters (`feSpecularLighting`, blurs, morphology) on every
 * part. One is cheap; a grid of nearly two hundred, each re-filtered by the browser as the grid
 * scrolls, is what made the gallery stutter even on a fast machine. So a thumbnail is drawn
 * **once**, onto a canvas at twice its display size, and the grid shows that bitmap: decoding a
 * 96-pixel WebP costs nothing, however fast the grid is scrolled.
 *
 * Only what is asked for is drawn — the grid asks as a thumbnail scrolls into view — and one at a
 * time, each in its own task, so drawing a screenful never holds up a frame. Kept for the
 * session by key (preset and colour), so scrolling back or switching back to a colour is
 * instant. The stickers on the map are untouched: they stay vector, sharp in every export.
 */

const SIZE = 96

const done = new Map<string, string>()
const waiting = new Map<string, Array<(url: string) => void>>()
const queue: Array<{ key: string; make: () => string }> = []
let running = false

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not draw the sticker'))
    image.src = src
  })
}

async function rasterise(src: string): Promise<string> {
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) return src
  const w = image.naturalWidth || SIZE
  const h = image.naturalHeight || SIZE
  const scale = Math.min(SIZE / w, SIZE / h)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
  return blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png')
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function run() {
  if (running) return
  running = true
  while (queue.length > 0) {
    // Newest first: what was asked for last is what has just scrolled into view.
    const job = queue.pop()!
    if (done.has(job.key)) continue
    let url: string
    try {
      url = await rasterise(job.make())
    } catch {
      url = ''
    }
    done.set(job.key, url)
    for (const resolve of waiting.get(job.key) ?? []) resolve(url)
    waiting.delete(job.key)
    await nextTask()
  }
  running = false
}

/** A thumbnail already drawn, or undefined. */
export function cachedThumbnail(key: string): string | undefined {
  return done.get(key)
}

/**
 * The thumbnail for `key`, drawing it from `make()` (an image URL, usually an SVG data URI) if it
 * has not been drawn yet. Resolves to '' when the image could not be drawn.
 */
export function thumbnail(key: string, make: () => string): Promise<string> {
  const known = done.get(key)
  if (known !== undefined) return Promise.resolve(known)
  return new Promise((resolve) => {
    const list = waiting.get(key)
    if (list) {
      list.push(resolve)
      // Asked for again: move it to the front of the queue.
      const at = queue.findIndex((job) => job.key === key)
      if (at >= 0) queue.push(...queue.splice(at, 1))
      return
    }
    waiting.set(key, [resolve])
    queue.push({ key, make })
    void run()
  })
}
