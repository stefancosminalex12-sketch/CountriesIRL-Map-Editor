/**
 * Which Map Detail a map starts at, which is not the same question on a phone.
 *
 * The world's geography comes at three resolutions — 110m, 50m and 10m — and the editor has
 * always opened at 10m, which is the right answer on a desktop: it is the detail someone
 * making a map wants to see, and a desktop draws it without noticing. A phone notices. The
 * same file is several times the size, several times the vertices, and every frame of every
 * gesture carries them, on a processor a quarter as fast.
 *
 * So on a small touch device the *automatic* choice is 50m where the open map has it, and on
 * everything else it is the atlas's own default, unchanged. Three things this deliberately
 * is not:
 *
 * - **It is not a cap.** 110m, 50m and 10m all stay in the picker on a phone, exactly as
 *   before, and choosing one loads it.
 * - **It is not sticky against the author.** The moment they choose a detail themselves, the
 *   automatic choice steps aside for the rest of the session ({@link noteDetailChosen}), so
 *   opening another map does not quietly hand them 50m again.
 * - **It is not re-decided later.** The device is read once, so turning a phone on its side,
 *   resizing, changing region, projection or panel never reconsiders it — a map that is on
 *   10m because someone asked for 10m stays there.
 *
 * Only the World map actually offers 50m; the administrative, USA and Europe atlases have one
 * resolution each (their levels are different geographies, not different resolutions of one),
 * so for those this returns exactly what it always did.
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

/**
 * What a phone opens at, when the map has it.
 *
 * The middle of the three, not the lightest: 110m is a different map rather than a coarser
 * one — it names 177 of the 254 entities this app knows, and the rest reach it through the
 * low-detail supplement — while 50m carries 240 of them at a fraction of 10m's weight. That
 * is the trade a phone wants by default: most of the geography, little of the cost.
 */
const STARTING_DETAIL: GeoDataset['detail'] = '50m'

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
 * where it is 50m if the atlas has it. An atlas without that resolution gets its default
 * either way, so nothing about those maps changes.
 */
export function startingDatasetId(atlas: Atlas): string {
  if (!automatic || !isCompactDevice()) return atlas.defaultDatasetId
  const chosen = atlas.datasets.find((dataset) => dataset.detail === STARTING_DETAIL)
  return chosen ? chosen.id : atlas.defaultDatasetId
}
