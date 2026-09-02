/**
 * Map image export.
 *
 * One rule decides everything here: **the export is a capture of the live map, not a
 * second rendering of it.** The source is the `<svg>` element already on screen, and
 * nothing in this module knows what a projection, a framing or a country is. It
 * cannot: there is no geometry pipeline to get it wrong with, so a zoomed, panned,
 * Robinson-projected map of Europe with three countries selected exports as exactly
 * that, because those things are already facts about the DOM node being copied.
 *
 * That also makes the whole operation read-only by construction. The element is
 * cloned before anything touches it; the store, the document, the camera and the
 * selection are never referenced, let alone written.
 *
 *   live <svg>  ->  clone + make self-contained  ->  SVG text
 *                                                     |
 *                                          +----------+----------+
 *                                          |                     |
 *                                        .svg            raster -> .png / .jpg
 *
 * PNG and JPEG go through that same SVG text, so there is one representation and one
 * pipeline. Raster differs only in being drawn into a canvas afterwards.
 *
 * What the map viewport contains is what gets exported. The zoom buttons, the hover
 * label and the loading notice are HTML siblings *outside* the SVG, so they are
 * excluded simply by copying the SVG — no filtering, nothing to keep in sync.
 */

export type ExportFormat = 'png' | 'jpg' | 'svg'

/** Raster exports render this many device pixels per CSS pixel. */
export const DEFAULT_RASTER_SCALE = 2

/** JPEG quality. High enough that coastlines do not pick up ringing. */
const JPEG_QUALITY = 0.95

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

export interface ExportSize {
  /** CSS pixels — the map viewport's own dimensions, never the window's. */
  width: number
  height: number
  /** Device pixels actually written, for raster formats. */
  pixelWidth: number
  pixelHeight: number
}

export interface ExportResult {
  blob: Blob
  filename: string
  size: ExportSize
}

/* ------------------------------------------------------------------ naming */

/**
 * Filesystem-safe, deterministic, and readable: `map-europe-robinson.png`.
 *
 * Diacritics are folded rather than stripped, so "Nell–Hammer" becomes
 * `nell-hammer` instead of `nellhammer` — the en dash is a separator, not noise.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface FilenameParts {
  /** Region names as the status bar describes them, e.g. `['Europe', 'Asia']`. */
  regions: string[]
  /** The projection actually in use — `auto` already resolved to its real name. */
  projection: string
  /** Dataset detail (`10m`), appended only when it disambiguates nothing else. */
  detail?: string
}

export function buildFilename(parts: FilenameParts, format: ExportFormat): string {
  const segments = ['map', ...parts.regions.map(slugify), slugify(parts.projection)]
  if (parts.detail) segments.push(slugify(parts.detail))
  const stem = segments.filter(Boolean).join('-') || 'map'
  return `${stem}.${format}`
}

/* ------------------------------------------------------ svg serialisation */

/**
 * Attributes that carry paint or geometry we may need to recover from CSS.
 *
 * In this app the map SVG is painted entirely through presentation *attributes*
 * written from `doc.style`, so there is normally nothing to recover — the stylesheet
 * only ever sets `cursor` and `display` on these elements. The list exists so the
 * export does not silently depend on that staying true: if a rule ever starts
 * painting through a class or a custom property, the value is read off
 * `getComputedStyle` and written onto the element instead of vanishing from the file.
 */
const PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linejoin',
  'stroke-linecap',
  'stroke-dasharray',
  'opacity',
  'vector-effect',
  'clip-path',
  'mask',
  'filter',
  'mix-blend-mode',
] as const

/**
 * Typography, inlined only onto elements that actually draw glyphs.
 *
 * The legend is the one thing in this SVG with text in it, and a font that resolves
 * from the app's stylesheet would come out as the renderer's default in a standalone
 * file. Kept separate from the paint list because `font-size` never computes to a
 * "default" worth skipping — applying it to all 254 country paths would add an
 * attribute to every one of them for nothing.
 */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath'])

const FONT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
] as const

/** Paint values that mean "nothing was set", and so are not worth inlining. */
function isDefaultPaint(property: string, value: string): boolean {
  if (!value) return true
  switch (property) {
    case 'fill':
      return value === 'rgb(0, 0, 0)'
    case 'stroke':
    case 'clip-path':
    case 'mask':
    case 'filter':
      return value === 'none'
    case 'fill-opacity':
    case 'stroke-opacity':
    case 'opacity':
      return value === '1'
    case 'stroke-width':
      return value === '1px' || value === '1'
    case 'fill-rule':
      return value === 'nonzero'
    case 'stroke-linejoin':
      return value === 'miter'
    case 'stroke-linecap':
      return value === 'butt'
    case 'stroke-dasharray':
      return value === 'none'
    case 'vector-effect':
      return value === 'none'
    case 'mix-blend-mode':
      return value === 'normal'
    default:
      return false
  }
}

/**
 * Makes a cloned node stand on its own outside the application.
 *
 * Two jobs. Anything the stylesheet was painting is resolved against the *live*
 * element and written onto the clone as an attribute, so no `var(--surface)` or class
 * selector survives into a file that will be opened without the app's CSS. And the
 * `class` attributes themselves are dropped, since the only rules they carry here are
 * `cursor: pointer` and `display: block` — interaction affordances that mean nothing
 * in a static image and would otherwise be dangling references.
 */
function inlineComputedPaint(live: Element, clone: Element): void {
  const computed = window.getComputedStyle(live)

  for (const property of PAINT_PROPERTIES) {
    const value = computed.getPropertyValue(property).trim()
    if (isDefaultPaint(property, value)) continue
    // An explicit attribute already says what the author meant; only fill the gaps,
    // so a `stroke-width="0.6"` is never rewritten to the computed `0.6px`.
    if (clone.hasAttribute(property)) continue
    if (value.includes('var(')) continue
    clone.setAttribute(property, value)
  }

  if (TEXT_ELEMENTS.has(live.tagName)) {
    for (const property of FONT_PROPERTIES) {
      if (clone.hasAttribute(property)) continue
      const value = computed.getPropertyValue(property).trim()
      if (!value || value.includes('var(')) continue
      clone.setAttribute(property, value)
    }
  }

  clone.removeAttribute('class')
  // Interaction bookkeeping, not picture content.
  clone.removeAttribute('data-country-id')
  clone.removeAttribute('data-legend')

  const styleAttr = clone.getAttribute('style')
  if (styleAttr && styleAttr.includes('var(')) clone.removeAttribute('style')
}

/**
 * The composition frame, as the live canvas reports it.
 *
 * Published by the renderer as data attributes on the `<svg>` rather than threaded
 * through every export entry point, so a path that has always taken just an element
 * keeps taking just an element and is cropped anyway. Absent or unreadable, the frame
 * is the whole canvas — which is what an uncomposed map means.
 */
function readFrame(source: SVGSVGElement, width: number, height: number) {
  const read = (name: string) => Number(source.dataset[name])
  const x = read('screenX')
  const y = read('screenY')
  const w = read('screenWidth')
  const h = read('screenHeight')
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    return { x: 0, y: 0, width, height }
  }
  return { x, y, width: w, height: h }
}

/**
 * Clones the live map SVG into a standalone document.
 *
 * `scale` widens the viewport without touching the `viewBox`, which is what keeps the
 * composition identical at any resolution: the same user-space geometry is simply
 * mapped onto more device pixels.
 */
function cloneMapSvg(source: SVGSVGElement, scale: number): { svg: SVGSVGElement; size: ExportSize } {
  const rect = source.getBoundingClientRect()
  const width = Math.max(1, Math.round(Number(source.getAttribute('width')) || rect.width))
  const height = Math.max(1, Math.round(Number(source.getAttribute('height')) || rect.height))

  const clone = source.cloneNode(true) as SVGSVGElement

  const liveNodes = [source, ...Array.from(source.querySelectorAll('*'))]
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (let i = 0; i < liveNodes.length && i < cloneNodes.length; i++) {
    inlineComputedPaint(liveNodes[i], cloneNodes[i])
  }

  /*
   * Editing chrome is dropped once the paint has been inlined.
   *
   * A few marks exist only to say that something can be grabbed — the legend's resize
   * corner and its hit area. They belong to the editor, not to the map, so they come out
   * of the picture entirely rather than being left in at low opacity. This runs after
   * the walk above and not before it, because that walk pairs the live and cloned trees
   * by index, and removing a node early would shift every node after it onto the wrong
   * partner.
   */
  for (const node of Array.from(clone.querySelectorAll('[data-export="none"]'))) {
    node.remove()
  }

  /*
   * The composition frame decides what the picture is.
   *
   * Cropping is a `viewBox`, not a clip: the map is drawn in viewport coordinates, so
   * naming the frame's rectangle as the view box shows exactly that part of exactly the
   * same scene. Nothing is re-laid-out, nothing is masked, and the geometry outside
   * simply falls outside the box — which is also why the frame itself never appears as
   * a border. The output's pixel size comes from the frame too, so an exported image
   * carries the aspect ratio that was composed rather than the browser window's.
   *
   * Read off the DOM rather than passed in, so every existing export path — PNG, JPG,
   * SVG, and anything that calls `serializeMapSvg` — is cropped without being changed.
   */
  const frame = readFrame(source, width, height)

  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('xmlns:xlink', XLINK_NS)
  clone.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.width} ${frame.height}`)
  clone.setAttribute('width', String(Math.round(frame.width * scale)))
  clone.setAttribute('height', String(Math.round(frame.height * scale)))
  clone.removeAttribute('id')
  clone.removeAttribute('style')
  // Editor bookkeeping, now spent: the crop it described is in the view box above.
  for (const name of ['screenX', 'screenY', 'screenWidth', 'screenHeight']) {
    delete clone.dataset[name]
  }

  /*
   * `vector-effect: non-scaling-stroke` measures stroke width in *device* pixels, so
   * that a country border stays hairline-thin however far the camera zooms in. That
   * is right on screen and wrong in a 2x export, where the same rule would draw the
   * borders at half their apparent weight and the picture would come out subtly
   * different from the one being captured. Scaling those widths with the viewport
   * restores the appearance exactly; strokes that scale normally are left alone,
   * because the viewBox already carries them.
   */
  if (scale !== 1) {
    for (const node of Array.from(clone.querySelectorAll('[vector-effect]'))) {
      if (node.getAttribute('vector-effect') !== 'non-scaling-stroke') continue
      const stroke = Number(node.getAttribute('stroke-width'))
      if (Number.isFinite(stroke) && stroke > 0) {
        node.setAttribute('stroke-width', String(stroke * scale))
      }
    }
  }

  return {
    svg: clone,
    // The picture's size, which is the frame's — callers rasterise onto this.
    size: {
      width: frame.width,
      height: frame.height,
      pixelWidth: Math.round(frame.width * scale),
      pixelHeight: Math.round(frame.height * scale),
    },
  }
}

/** The current map view as standalone SVG text. */
export function serializeMapSvg(source: SVGSVGElement, scale = 1): { markup: string; size: ExportSize } {
  const { svg, size } = cloneMapSvg(source, scale)
  const body = new XMLSerializer().serializeToString(svg)
  return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${body}`, size }
}

/* ---------------------------------------------------------------- raster */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The map image could not be rasterised'))
    image.src = url
  })
}

/**
 * Draws the exported SVG into a canvas.
 *
 * The same markup the `.svg` download would contain, so there is no second renderer
 * and no way for the two to disagree. A blob URL rather than a `data:` URL because
 * a detailed world map serialises to megabytes and percent-encoding all of it is
 * both slow and needless; the blob is same-origin, so the canvas stays untainted.
 */
async function rasterize(
  source: SVGSVGElement,
  scale: number,
  background: string | null,
): Promise<{ canvas: HTMLCanvasElement; size: ExportSize }> {
  const { markup, size } = serializeMapSvg(source, scale)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = size.pixelWidth
    canvas.height = size.pixelHeight

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable in this browser')

    /*
     * JPEG has no alpha channel, so anything left transparent would be encoded as
     * black. Painting the map's own background underneath first means a transparent
     * map exports against the colour it is actually being viewed on. PNG keeps its
     * alpha and is passed `null`, so a genuinely transparent map stays transparent.
     */
    if (background) {
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { canvas, size }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode ${type}`))),
      type,
      quality,
    )
  })
}

/* ----------------------------------------------------------------- export */

export interface ExportOptions {
  format: ExportFormat
  filename: string
  /** Device pixels per CSS pixel for raster formats. */
  scale?: number
  /**
   * Colour composited under the map for formats without alpha. The map already
   * paints its own background rect, so this only matters if that ever stops being
   * true — but JPEG must never be handed a transparent canvas.
   */
  background: string
}

/**
 * Produces the export as a `Blob`. Pure: it reads the DOM and returns bytes.
 *
 * Kept separate from the download so the same call serves a future "copy to
 * clipboard" or an automated check, and so tests can assert on the bytes.
 */
export async function renderMapExport(
  source: SVGSVGElement,
  options: ExportOptions,
): Promise<ExportResult> {
  const { format, filename } = options

  if (format === 'svg') {
    const { markup, size } = serializeMapSvg(source, 1)
    return {
      blob: new Blob([markup], { type: `${MIME.svg};charset=utf-8` }),
      filename,
      size,
    }
  }

  const scale = options.scale ?? DEFAULT_RASTER_SCALE
  const { canvas, size } = await rasterize(
    source,
    scale,
    format === 'jpg' ? options.background : null,
  )
  const blob = await canvasToBlob(canvas, MIME[format], format === 'jpg' ? JPEG_QUALITY : undefined)
  return { blob, filename, size }
}

/** Hands a produced blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next frame: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Finds the live map SVG. Returns null when the canvas is not mounted. */
export function findMapSvg(id: string): SVGSVGElement | null {
  const element = document.getElementById(id)
  return element instanceof SVGSVGElement ? element : null
}
