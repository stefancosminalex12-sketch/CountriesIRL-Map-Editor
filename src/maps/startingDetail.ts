/**
 * Which Map Detail a map starts at, which is not the same question on a phone.
 *
 * The world's geography comes at three resolutions — 110m, 50m and 10m — and the editor has
 * always opened at 10m, which is the right answer on a desktop: it is the detail someone
 * making a map wants to see, and a desktop draws it without noticing. A phone notices. The
 * same file is several times the size, several times the vertices, and every frame of every
 * gesture carries them, on a processor a quarter as fast.
 *
 * So on a small touch device the *automatic* choice is the lightest geography the open map
 * offers, and on everything else it is the atlas's own default, unchanged. Three things this
 * deliberately is not:
 *
 * - **It is not a cap.** 50m and 10m stay in the picker on a phone, exactly as before, and
 *   choosing one loads it.
 * - **It is not sticky against the author.** The moment they choose a detail themselves, the
 *   automatic choice steps aside for the rest of the session ({@link noteDetailChosen}), so
 *   opening another map does not quietly hand them 110m again.
 * - **It is not re-decided later.** The device is read once, so turning a phone on its side,
 *   resizing, changing region, projection or panel never reconsiders it — a map that is on
 *   10m because someone asked for 10m stays there.
 *
 * Only the World map actually has anything lighter than 10m; the administrative, USA and
 * Europe atlases have one resolution each (their levels are different geographies, not
 * different resolutions of one), so for those this returns exactly what it always did.
 */
import type { Atlas } from './atlas'
import type { GeoDataset } from '../geo/datasets'

/**
 * The longest a phone's shorter side gets.
 *
 * Measured on the screen rather than the window, and on the *shorter* side, so it says the
 * same thing in portrait and landscape — a phone held sideways is still a phone. 820 is a
 * small tablet in portrait; a laptop's 800-tall window is not caught, because the test below
 * also asks for a coarse pointer.
 */
const COMPACT_MAX_PX = 820

/** Lightest first. What "the lightest geography this atlas offers" is measured against. */
const DETAIL_ORDER: Record<GeoDataset['detail'], number> = { '110m': 0, '50m': 1, '10m': 2 }

/**
 * Whether this is a small touch device, decided once.
 *
 * Both halves matter. A coarse pointer alone is a touchscreen laptop; a small window alone is
 * a desktop browser someone has narrowed. Together they are a phone or a small tablet.
 */
let compactDevice: boolean | null = null

export function isCompactDevice(): boolean {
  if (compactDevice !== null) return compactDevice
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    compactDevice = false
    return compactDevice
  }
  const coarse =
    window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 1
  const screen = window.screen
  const shorter = screen ? Math.min(screen.width, screen.height) : Math.min(window.innerWidth, window.innerHeight)
  compactDevice = coarse && shorter > 0 && shorter <= COMPACT_MAX_PX
  return compactDevice
}

/**
 * Whether the automatic choice is still the one making this decision.
 *
 * True until the author picks a detail themselves. Session state, deliberately: it is about
 * what they have done here, not a preference to remember, and it is in no document, no undo
 * step and no export.
 */
let automatic = true

/** Called when the author chooses a detail themselves. See the note above. */
export function noteDetailChosen(): void {
  automatic = false
}

/** Whether a fresh map would still take the automatic choice. Exposed for the tests. */
export function detailIsAutomatic(): boolean {
  return automatic
}

/**
 * The dataset a fresh document of this atlas opens at.
 *
 * The atlas's own default, except on a small touch device that has not been told otherwise,
 * where it is the lightest resolution the atlas has. An atlas with one resolution gets its
 * default either way, so nothing about those maps changes.
 */
export function startingDatasetId(atlas: Atlas): string {
  if (!automatic || !isCompactDevice()) return atlas.defaultDatasetId
  const fallback = atlas.datasets.find((dataset) => dataset.id === atlas.defaultDatasetId)
  if (!fallback) return atlas.defaultDatasetId
  let lightest = fallback
  for (const dataset of atlas.datasets) {
    if (DETAIL_ORDER[dataset.detail] < DETAIL_ORDER[lightest.detail]) lightest = dataset
  }
  return lightest.id
}
