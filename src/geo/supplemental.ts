/**
 * Supplemental country geometry.
 *
 * A dataset can fail to describe a country in three ways, and all three end with the
 * country missing from the map:
 *
 *   - it is smaller than the quantisation step. Natural Earth's TopoJSON quantises
 *     longitude to ~0.0036° (about 400 m), and Vatican City is roughly 1 km across,
 *     so even at 10m its ring collapses to two distinct corners.
 *   - the layer leaves it out. world-atlas ships the same countries at three
 *     resolutions and the coarser two simply omit what is too small to draw: the
 *     110m layer names 177 of the 254 entities this app knows, the 50m layer 240. On
 *     the 110m map that is Monaco, Malta, Singapore, Hong Kong, Bermuda and 72 more.
 *   - it is described, but badly. Bahrain's archipelago is merged down to its main
 *     island, losing Muharraq, Umm an Nasan and the whole Hawar group.
 *
 * This module answers all three from one place, kept separate from the Natural Earth
 * files, which stay untouched. A supplemental boundary is used only as a fallback: if
 * the loaded dataset provides usable geometry for that country the dataset wins and
 * the supplement is ignored, so nothing is ever drawn twice and no resolution ever
 * loses detail it actually had. That rule is per dataset, so the same country can be
 * supplemented at one resolution and come from the source at another — which is
 * exactly what the 110m/50m/10m switch needs, and what a future historical dataset
 * will need too.
 *
 * Most entries are generated rather than hand-written: `lowDetailGeometry.ts` carries
 * a shape for every entity a coarser layer omits, lifted from the coarsest layer that
 * does describe it and simplified to that layer's own vertex budget. Only the cases
 * no source can supply are maintained by hand below.
 *
 * These are real geographic coordinates in lon/lat degrees, so they project, pan,
 * zoom, hit-test and export exactly like any other country — a supplemented entity
 * enters the same pipeline as a source-data one and needs no special handling
 * anywhere downstream.
 *
 * Each entry is a *country's* shape. On a map whose entities are parts of countries —
 * the administrative world — it becomes the shape of the country's only part when the
 * country is a single entity there, which is how Vatican City's one subdivision survives
 * the same quantisation. See the supplement step in `loadGeoDataset`.
 */
import type { Position } from 'geojson'
import { LOW_DETAIL_COUNTRIES } from './lowDetailGeometry'
import type { CountryId } from '../types/map'
import type { GeoDetail } from './datasets'

/**
 * How a supplement relates to whatever the dataset already provides.
 *
 * `fallback` — use it only when the dataset produced no usable geometry at all.
 * `replace`  — the dataset's geometry exists but is incomplete, and this is the
 *              authoritative shape. Used where the simplified country layer has
 *              merged an archipelago down to its largest island.
 */
export type SupplementalMode = 'fallback' | 'replace'

export interface SupplementalCountry {
  /** Stable country id, matching the ISO alpha-3 used everywhere else. */
  id: CountryId
  /** Only for reference — the display name still comes from the ISO country table. */
  name: string
  mode: SupplementalMode
  /**
   * Polygons, outer ring first per polygon. A single-polygon country has one entry.
   */
  polygons: Position[][][]
  /**
   * Dataset resolutions this applies to. A supplement carries the detail of the
   * source it came from, so it is only offered to maps drawn at that level —
   * dropping 10m coastlines into the 110m map would look wrong next to its
   * nine-point neighbours. Omit to apply everywhere.
   */
  appliesToDetail?: GeoDetail[]
  /**
   * Drawn this many times its true size, about its own centre, or absent for true size.
   *
   * For an entity too small to be seen or clicked at any zoom the map offers, and for nothing
   * else: every other entity on the map is drawn at its real size, and this is the one
   * deliberate exception to that. A constant factor on the geometry itself, not a floor on
   * screen size — so it grows and shrinks with the camera exactly like its neighbours, it is
   * the same shape in every export, and hit-testing, flags, labels, overlays and merges all
   * see one outline. The old zoom-dependent floor (`minimumSizeTransform`) was removed because
   * a speck held at a constant screen size grew against its neighbours as the camera zoomed
   * out; a constant geographic factor cannot do that.
   */
  enlarge?: number
  /** Why this entry exists, so it can be retired when a dataset covers it. */
  note: string
}

/**
 * Simplified boundary of Vatican City (~0.49 km²), traced from its real extent:
 * roughly 12.4457–12.4583°E, 41.9002–41.9075°N.
 *
 * **`replace`, on every map.** Natural Earth's own 10m Vatican is a seven-point placeholder
 * 0.11 × 0.13 km — a tenth of the real state's width, sitting in its north-east corner — and
 * its admin-1 Vatican is a 0.012 km² shard. This outline is the real one, so it wins wherever
 * it is offered: the World map at every resolution and the administrative world's single
 * Vatican unit. It used to be a fallback, which left the World map drawing the placeholder.
 *
 * **Drawn six times its true size.** Vatican City is about 1 km across; on a 1,280 px window
 * the whole world is 1,224 px, so even at the map's deepest zoom (40×) the state is 1.4 px — a
 * dot nobody can see, never mind aim at. Six times is the smallest whole factor that makes its
 * outline a target of more than 8 px at that zoom (8.6 px), which is where anyone looking for
 * it ends up. It stays small everywhere else: 0.2 px at world zoom, 1.7 px with Italy filling
 * the window. The assist catchment that already reaches past every speck still supplies the
 * full touch target — on a phone, where the same zoom draws it at under 3 px, that catchment
 * is what a finger lands on — so nothing here tries to be a touch target by itself. 16 km² as
 * drawn, still smaller than San Marino and a quarter the size of the Rome district it sits in;
 * the only neighbour it now outdraws is Monaco, which is drawn at its true 2 km².
 */
const VATICAN_CITY: SupplementalCountry = {
  id: 'VAT',
  name: 'Vatican City',
  mode: 'replace',
  enlarge: 6,
  polygons: [
    [
      [
        [12.4467, 41.9024],
        [12.4512, 41.9002],
        [12.456, 41.9013],
        [12.4583, 41.9032],
        [12.4565, 41.906],
        [12.4525, 41.9075],
        [12.4475, 41.9068],
        [12.4457, 41.9048],
        [12.4467, 41.9024],
      ],
    ],
  ],
  note:
    'Absent at 110m, a seven-point placeholder a tenth of its width at 10m, and a shard on the ' +
    'administrative map: the real outline, drawn six times its size so it can be seen and clicked.',
}

/*
 * Bahrain used to be replaced here: the older country layer kept only its main island.
 * The curated foundation (`scripts/build-geography.mjs`) is built from Natural Earth's
 * current admin-0, which draws all seven of its polygons, so there is nothing left to fix.
 */

/**
 * Everything the coarser layers omit, as fallbacks scoped to the resolutions that
 * omit it.
 *
 * Generated, so the list follows the datasets rather than a hand-kept roster: an
 * entity appears here because a layer has no geometry for it, and disappears again if
 * a future dataset supplies one. Nothing is added for being small — Cyprus is smaller
 * than Kiribati and is in every layer, so it is not here.
 */
const LOW_DETAIL_FALLBACKS: SupplementalCountry[] = LOW_DETAIL_COUNTRIES.map((entry) => ({
  id: entry.id,
  name: entry.name,
  mode: 'fallback',
  polygons: entry.polygons,
  appliesToDetail: entry.appliesToDetail,
  note: `Absent from the ${entry.appliesToDetail.join(' and ')} layer; simplified from ${entry.sourceDetail}.`,
}))

export const SUPPLEMENTAL_COUNTRIES: SupplementalCountry[] = [
  VATICAN_CITY,
  ...LOW_DETAIL_FALLBACKS,
]

export function getSupplementalCountry(id: CountryId): SupplementalCountry | undefined {
  return SUPPLEMENTAL_COUNTRIES.find((c) => c.id === id)
}
