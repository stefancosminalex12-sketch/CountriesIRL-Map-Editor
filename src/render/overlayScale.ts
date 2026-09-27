import { OVERLAY_SCALE_RANGE } from '../types/map'

export const OVERLAY_SIZE_MIN = Math.log2(OVERLAY_SCALE_RANGE.min)
export const OVERLAY_SIZE_MAX = Math.log2(OVERLAY_SCALE_RANGE.max)

/** Guard rendering against malformed saved values as well as enforce the supported range. */
export function clampOverlayScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(OVERLAY_SCALE_RANGE.max, Math.max(OVERLAY_SCALE_RANGE.min, value))
}

/** Logarithmic slider: preserve precision at small scales and reach both endpoints exactly. */
export function overlayScaleAt(position: number): number {
  if (!Number.isFinite(position)) return 1
  if (position >= OVERLAY_SIZE_MAX - 0.01) return OVERLAY_SCALE_RANGE.max
  if (position <= OVERLAY_SIZE_MIN + 0.01) return OVERLAY_SCALE_RANGE.min
  const scale = Number((2 ** position).toPrecision(6))
  return Math.abs(scale - 1) <= 0.03 ? 1 : clampOverlayScale(scale)
}
