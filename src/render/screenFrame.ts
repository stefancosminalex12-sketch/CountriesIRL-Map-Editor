/**
 * The composition frame, resolved against a viewport.
 *
 * The document stores the frame in viewport pixels, because an author who drags an
 * edge is stating where the picture ends and that is not a ratio. But a stored
 * rectangle can outlive the window it was drawn in — a map composed on a wide monitor
 * and reopened on a laptop — so nothing reads `doc.screen.rect` directly. Everything
 * goes through {@link resolveScreen}, which is the one place that decides what the
 * frame *is* right now.
 */

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** Smallest frame a drag may leave, so an edge can always be grabbed again. */
export const MIN_SCREEN = 80

/** Breathing room kept between the region and the frame, as a share of the frame. */
const REGION_MARGIN = 0.07

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * The frame as it applies to this viewport.
 *
 * An unset rect is the whole canvas — an uncomposed map behaves exactly as it did
 * before the frame existed. A stored rect is clamped into the viewport rather than
 * rejected, so a composition made at another size degrades to the nearest one that
 * fits instead of disappearing.
 */
export function resolveScreen(
  rect: ScreenRect | null | undefined,
  width: number,
  height: number,
): ScreenRect {
  const full = { x: 0, y: 0, width, height }
  if (!rect || width < 2 || height < 2) return full

  const w = clamp(rect.width, Math.min(MIN_SCREEN, width), width)
  const h = clamp(rect.height, Math.min(MIN_SCREEN, height), height)
  return {
    x: clamp(rect.x, 0, Math.max(0, width - w)),
    y: clamp(rect.y, 0, Math.max(0, height - h)),
    width: w,
    height: h,
  }
}

/** True when the frame covers the whole canvas, so there is nothing to dim or crop. */
export function isFullScreen(screen: ScreenRect, width: number, height: number): boolean {
  return (
    screen.x <= 0.5 &&
    screen.y <= 0.5 &&
    screen.width >= width - 1 &&
    screen.height >= height - 1
  )
}

/**
 * The largest rectangle of `ratio` that fits the viewport, centred, with a margin.
 *
 * Used when a preset is chosen. Centred rather than anchored to the previous frame:
 * picking a ratio is a fresh statement about the composition, and preserving a corner
 * from the last one would put the new frame somewhere neither ratio asked for.
 */
export function fitAspect(ratio: number, width: number, height: number, margin = 0.06): ScreenRect {
  const availableW = width * (1 - margin * 2)
  const availableH = height * (1 - margin * 2)
  let w = availableW
  let h = w / ratio
  if (h > availableH) {
    h = availableH
    w = h * ratio
  }
  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  }
}

/**
 * A frame sized to the region as it is currently drawn.
 *
 * This is where the composition's aspect actually comes from, and it is read off the
 * *projected* geometry rather than declared: the same continent has a different shape
 * under every projection, so Africa arrives tall, Europe wide, and Asia wide-and-shallow
 * without any of them being named. Change the projection and the answer changes with it,
 * because the input did.
 *
 * The frame moves to the map, never the other way round. Nothing here touches the
 * projection, the zoom or the translation — it reads where the region already is and
 * puts a rectangle around it.
 *
 * `points` are projected screen coordinates; `transform` is the live camera, so a frame
 * proposed while zoomed lands on what the author can actually see.
 */
export function fitRegionScreen(
  points: Iterable<[number, number]>,
  transform: { k: number; x: number; y: number },
  width: number,
  height: number,
): ScreenRect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity

  for (const point of points) {
    if (!point) continue
    const x = point[0] * transform.k + transform.x
    const y = point[1] * transform.k + transform.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }

  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null

  /*
   * The margin is a share of the region rather than of the canvas, so a small region
   * gets a close crop and a large one is not squeezed — the breathing room belongs to
   * the subject, not to the window it happens to be viewed in.
   */
  const padX = (x1 - x0) * REGION_MARGIN
  const padY = (y1 - y0) * REGION_MARGIN

  // Clipped to the canvas: a frame is a crop of what is on screen, and cannot describe
  // geography that is currently off it.
  const left = Math.max(0, x0 - padX)
  const top = Math.max(0, y0 - padY)
  const right = Math.min(width, x1 + padX)
  const bottom = Math.min(height, y1 + padY)

  const w = Math.max(MIN_SCREEN, right - left)
  const h = Math.max(MIN_SCREEN, bottom - top)
  return {
    x: clamp(left, 0, Math.max(0, width - w)),
    y: clamp(top, 0, Math.max(0, height - h)),
    width: Math.min(w, width),
    height: Math.min(h, height),
  }
}
