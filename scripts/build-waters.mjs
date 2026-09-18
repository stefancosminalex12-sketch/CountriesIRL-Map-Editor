/**
 * Builds the named water regions — the oceans and seas the editor can select.
 *
 * A maintenance script, NOT part of the build, exactly like `build-geography.mjs`: it reads
 * Natural Earth from `.cache/ne/` (downloading what is missing, or everything with
 * `--refresh`) and writes `data/natural-earth/waters.geojson`, which is committed.
 * `npm run dev` / `npm run build` only copy that result, so ordinary builds stay offline.
 *
 *   node scripts/build-waters.mjs
 *   node scripts/build-waters.mjs --refresh
 *
 * Source: Natural Earth's 1:50m marine geography (`ne_50m_geography_marine_polys`), via
 * github.com/nvkelso/natural-earth-vector — public domain. These are the real marine
 * polygons: each one's outline follows the coast and carries a hole for every island the
 * source cuts out — Sicily, Cyprus, Crete, Gotland, Cuba, Hainan, Taiwan — so nothing here
 * is a circle, a box, a bounding box or a shape anybody drew by hand.
 *
 * Why 50m rather than 10m. The water is drawn *under* the land at every resolution (see
 * `MapWaters`), so its landward edge is covered by whichever coastline the map draws; what
 * this layer has to get right is the *extent* — where the Mediterranean ends and the
 * Atlantic begins — and the 50m edition states that as well as the 10m one, in a file a
 * phone can hold. One file for every map, as required: no per-dataset variants to keep in
 * step, and nothing about the existing island-water layer (`fetch-eez.mjs`) is touched.
 *
 * ## Sixteen regions, and the whole ocean surface
 *
 * Natural Earth's marine layer is 118 features: five ocean sheets, the named seas cut out of
 * them, and then every gulf, bay, strait, channel, sound, reef and river mouth it names. The
 * editor offers the sixteen major oceans and seas and nothing else — a hundred selectable
 * bays is a hundred things to click past on the way to the Mediterranean.
 *
 * But the small features are cut *out* of the big ones, so keeping only sixteen features
 * would leave the Pacific full of holes: colouring it would paint everything except the
 * Philippine Sea, the Coral Sea, the Bering Sea and thirty more. So every marine feature is
 * folded into the region it belongs to, and the sixteen regions tile the entire ocean
 * surface with no gap and no overlap. `PARENT` below is that table, one line per feature,
 * following the IHO's Limits of Oceans and Seas where it decides the question — the
 * Norwegian Sea is Atlantic and the Greenland Sea is Arctic, because that is where they
 * are put — and the adjoining sea where it is a matter of taste (the Persian Gulf and the
 * Gulf of Aden go with the Arabian Sea).
 *
 * The one thing folded in that is not a sea: the gulfs *of* a sea the list already has, like
 * the Gulf of Bothnia. Rivers and reefs are dropped outright — a river is not a water region
 * and the Great Barrier Reef polygon lies on top of the Coral Sea rather than beside it.
 *
 * Three things are then done to the geometry, each explained where it happens:
 *
 *   1. the parts of a region are unioned into the one shape it is, so the Pacific's
 *      equatorial cut and the line between a sea and the gulf inside it are gone;
 *   2. the water Natural Earth names nowhere — the western Aegean, the Sea of Azov, the
 *      pockets behind a hundred coasts — is given to the region beside it, so a coloured sea
 *      has no holes in it. Its edges are the 50m coastline, islands and all;
 *   3. everything is cut at 60°S, the Southern Ocean's defined limit, which is the one place
 *      Natural Earth's own layer has two features over the same sea.
 *
 * The result is sixteen regions that cover 363.5 of the world's 363.4 million km² of sea and
 * lake — the excess being two coastal lagoons — with no overlap.
 *
 * The script refuses to write a file that fails its own checks: every marine feature placed,
 * every region non-empty, no two regions overlapping (sampled), and a total between the
 * marine layer's own area and the area of water there is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoArea, geoCentroid, geoContains, geoDistance } from 'd3-geo'
import { dissolve, oriented, polygonsOf } from './admin/geometry.mjs'
import * as clipper from './admin/clip.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = resolve(root, '.cache/ne')
const outDir = resolve(root, 'data/natural-earth')
const REFRESH = process.argv.includes('--refresh')
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
const SOURCE = 'ne_50m_geography_marine_polys'

/** Coordinates kept, as on the lake and river layers: 4 dp is ~11 m. */
const COORD_PRECISION = 4

const EARTH_KM = 6371

/**
 * The regions the editor offers, in draw order: oceans first, so a sea lying inside one is
 * drawn over it rather than under it.
 *
 * `id` is the entity id the document and the selection use. The `water-` prefix is the whole
 * of the separation from land: no country, subdivision, merged body or overlay id can look
 * like one, so no code that handles ids can mistake a sea for a country.
 */
const REGIONS = [
  { id: 'water-pacific-ocean', name: 'Pacific Ocean', category: 'ocean' },
  { id: 'water-atlantic-ocean', name: 'Atlantic Ocean', category: 'ocean' },
  { id: 'water-indian-ocean', name: 'Indian Ocean', category: 'ocean' },
  { id: 'water-southern-ocean', name: 'Southern Ocean', category: 'ocean' },
  { id: 'water-arctic-ocean', name: 'Arctic Ocean', category: 'ocean' },
  { id: 'water-caribbean-sea', name: 'Caribbean Sea', category: 'sea' },
  { id: 'water-mediterranean-sea', name: 'Mediterranean Sea', category: 'sea' },
  { id: 'water-black-sea', name: 'Black Sea', category: 'sea' },
  { id: 'water-baltic-sea', name: 'Baltic Sea', category: 'sea' },
  { id: 'water-north-sea', name: 'North Sea', category: 'sea' },
  { id: 'water-red-sea', name: 'Red Sea', category: 'sea' },
  { id: 'water-arabian-sea', name: 'Arabian Sea', category: 'sea' },
  { id: 'water-south-china-sea', name: 'South China Sea', category: 'sea' },
  { id: 'water-east-china-sea', name: 'East China Sea', category: 'sea' },
  { id: 'water-sea-of-japan', name: 'Sea of Japan', category: 'sea' },
  { id: 'water-caspian-sea', name: 'Caspian Sea', category: 'sea' },
]

/**
 * Which region every marine feature belongs to, by Natural Earth's own name.
 *
 * Keys are matched case-insensitively, because the layer sets the oceans' names in capitals
 * and everything else in title case. A feature the layer adds in a future edition and this
 * table does not name stops the build rather than disappearing quietly.
 */
const PARENT = {
  /* ---------------------------------------------------------------- Pacific */
  'north pacific ocean': 'water-pacific-ocean',
  'south pacific ocean': 'water-pacific-ocean',
  'philippine sea': 'water-pacific-ocean',
  'coral sea': 'water-pacific-ocean',
  'tasman sea': 'water-pacific-ocean',
  'bering sea': 'water-pacific-ocean',
  'sea of okhotsk': 'water-pacific-ocean',
  'solomon sea': 'water-pacific-ocean',
  'bismarck sea': 'water-pacific-ocean',
  'banda sea': 'water-pacific-ocean',
  'arafura sea': 'water-pacific-ocean',
  'java sea': 'water-pacific-ocean',
  'celebes sea': 'water-pacific-ocean',
  'sulu sea': 'water-pacific-ocean',
  'molucca sea': 'water-pacific-ocean',
  'ceram sea': 'water-pacific-ocean',
  'yellow sea': 'water-pacific-ocean',
  'bo hai': 'water-pacific-ocean',
  'gulf of alaska': 'water-pacific-ocean',
  'gulf of carpentaria': 'water-pacific-ocean',
  'shelikhova gulf': 'water-pacific-ocean',
  'golfo de california': 'water-pacific-ocean',
  'golfo de panamá': 'water-pacific-ocean',
  'gulf of maine': 'water-atlantic-ocean',
  'makassar strait': 'water-pacific-ocean',
  'bristol bay': 'water-pacific-ocean',
  'cook inlet': 'water-pacific-ocean',
  'bay of plenty': 'water-pacific-ocean',
  'luzon strait': 'water-pacific-ocean',

  /* --------------------------------------------------------------- Atlantic */
  'north atlantic ocean': 'water-atlantic-ocean',
  'south atlantic ocean': 'water-atlantic-ocean',
  'sargasso sea': 'water-atlantic-ocean',
  'gulf of mexico': 'water-atlantic-ocean',
  'bahía de campeche': 'water-atlantic-ocean',
  'norwegian sea': 'water-atlantic-ocean',
  'labrador sea': 'water-atlantic-ocean',
  'bay of biscay': 'water-atlantic-ocean',
  'irish sea': 'water-atlantic-ocean',
  'english channel': 'water-atlantic-ocean',
  'bristol channel': 'water-atlantic-ocean',
  'inner seas': 'water-atlantic-ocean',
  'inner sea': 'water-atlantic-ocean',
  'straits of florida': 'water-atlantic-ocean',
  'gulf of saint lawrence': 'water-atlantic-ocean',
  'chesapeake bay': 'water-atlantic-ocean',
  'bay of fundy': 'water-atlantic-ocean',
  'río de la plata': 'water-atlantic-ocean',
  'golfo san jorge': 'water-atlantic-ocean',
  'gulf of guinea': 'water-atlantic-ocean',
  'scotia sea': 'water-atlantic-ocean',
  'drake passage': 'water-atlantic-ocean',

  /* ----------------------------------------------------------------- Indian */
  'indian ocean': 'water-indian-ocean',
  'bay of bengal': 'water-indian-ocean',
  'andaman sea': 'water-indian-ocean',
  'laccadive sea': 'water-indian-ocean',
  'timor sea': 'water-indian-ocean',
  'mozambique channel': 'water-indian-ocean',
  'great australian bight': 'water-indian-ocean',
  'gulf of mannar': 'water-indian-ocean',
  'strait of malacca': 'water-indian-ocean',
  'gulf of kutch': 'water-indian-ocean',

  /* --------------------------------------------------------------- Southern */
  'southern ocean': 'water-southern-ocean',
  'weddell sea': 'water-southern-ocean',
  'ross sea': 'water-southern-ocean',
  'bellingshausen sea': 'water-southern-ocean',
  'amundsen sea': 'water-southern-ocean',

  /* ----------------------------------------------------------------- Arctic */
  'arctic ocean': 'water-arctic-ocean',
  'barents sea': 'water-arctic-ocean',
  'greenland sea': 'water-arctic-ocean',
  'kara sea': 'water-arctic-ocean',
  'laptev sea': 'water-arctic-ocean',
  'chukchi sea': 'water-arctic-ocean',
  'beaufort sea': 'water-arctic-ocean',
  'white sea': 'water-arctic-ocean',
  'baffin bay': 'water-arctic-ocean',
  'davis strait': 'water-arctic-ocean',
  'hudson bay': 'water-arctic-ocean',
  'hudson strait': 'water-arctic-ocean',
  'james bay': 'water-arctic-ocean',
  'ungava bay': 'water-arctic-ocean',
  'melville bay': 'water-arctic-ocean',
  'the north western passages': 'water-arctic-ocean',
  'viscount melville sound': 'water-arctic-ocean',
  'amundsen gulf': 'water-arctic-ocean',

  /* -------------------------------------------------------- the named seas */
  'caribbean sea': 'water-caribbean-sea',
  'gulf of honduras': 'water-caribbean-sea',
  'mediterranean sea': 'water-mediterranean-sea',
  'tyrrhenian sea': 'water-mediterranean-sea',
  'ionian sea': 'water-mediterranean-sea',
  'adriatic sea': 'water-mediterranean-sea',
  'aegean sea': 'water-mediterranean-sea',
  'balearic sea': 'water-mediterranean-sea',
  'golfe du lion': 'water-mediterranean-sea',
  'strait of gibraltar': 'water-mediterranean-sea',
  'black sea': 'water-black-sea',
  'baltic sea': 'water-baltic-sea',
  'gulf of bothnia': 'water-baltic-sea',
  'gulf of finland': 'water-baltic-sea',
  'north sea': 'water-north-sea',
  'red sea': 'water-red-sea',
  'arabian sea': 'water-arabian-sea',
  'gulf of aden': 'water-arabian-sea',
  'gulf of oman': 'water-arabian-sea',
  'persian gulf': 'water-arabian-sea',
  'south china sea': 'water-south-china-sea',
  'gulf of thailand': 'water-south-china-sea',
  'gulf of tonkin': 'water-south-china-sea',
  'taiwan strait': 'water-south-china-sea',
  'strait of singapore': 'water-south-china-sea',
  'east china sea': 'water-east-china-sea',
  'sea of japan': 'water-sea-of-japan',
  'korea strait': 'water-sea-of-japan',
  'caspian sea': 'water-caspian-sea',
}

/**
 * The Southern Ocean's northern limit: 60°S, the parallel the IHO's 2000 proposal and every
 * modern chart use.
 *
 * It has to be stated here because Natural Earth does not partition this water. Its
 * `SOUTHERN OCEAN` feature is a narrow label polygon hugging the Antarctic coast, while its
 * Indian, Pacific and Atlantic sheets run all the way down to the continent — the one place
 * in the layer where two features cover the same sea. So everything is cut at 60°S: south of
 * it is the Southern Ocean, north of it belongs to the ocean whose sheet it came from, and
 * the Weddell, Ross, Bellingshausen and Amundsen seas — wholly south of the parallel — are
 * part of it either way.
 *
 * Every coordinate in the result is still Natural Earth's, save the points along the
 * parallel itself, which is the definition rather than an approximation of anything.
 */
const SOUTHERN_LIMIT = -60

/**
 * The cut, as a polygon: the parallel walked degree by degree so it stays a parallel.
 *
 * d3 draws the segment between two points as a great-circle arc, which between two points on
 * a parallel bows towards the pole. A vertex every degree of longitude keeps that bow at
 * about a metre, which is finer than the source's own detail.
 */
const southOfLimit = [
  [
    [
      ...Array.from({ length: 361 }, (_, i) => [-180 + i, SOUTHERN_LIMIT]),
      [180, -90],
      [-180, -90],
      [-180, SOUTHERN_LIMIT],
    ],
  ],
]

/**
 * Feature classes that are not water regions.
 *
 * A river's mouth is a river, and a reef is a structure lying *on* a sea rather than a part
 * of one — Natural Earth's Great Barrier Reef polygon overlaps the Coral Sea, and folding it
 * in would be the one place two regions could overlap themselves.
 */
const DROP_CLASSES = new Set(['river', 'reef'])

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function source(name) {
  const path = resolve(cacheDir, `${name}.geojson`)
  if (!existsSync(path) || REFRESH) {
    console.log(`[waters] fetching ${name}`)
    const response = await fetch(`${NE}${name}.geojson`)
    if (!response.ok) throw new Error(`${name} -> ${response.status}`)
    writeFileSync(path, await response.text())
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

const rounded = (polygons) =>
  polygons.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [Number(x.toFixed(COORD_PRECISION)), Number(y.toFixed(COORD_PRECISION))])),
  )

/** Drops a ring rounding has collapsed to a line or a point, and any polygon left without one. */
const substantial = (polygons) =>
  polygons.map((polygon) => polygon.filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length > 0)

/* ------------------------------------------------------------------- build */

const marine = await source(SOURCE)

const parts = new Map(REGIONS.map((region) => [region.id, []]))
const members = new Map(REGIONS.map((region) => [region.id, []]))
const unnamed = []
const dropped = []

for (const feature of marine.features) {
  const name = feature.properties?.name
  const featureClass = feature.properties?.featurecla ?? ''
  const polygons = polygonsOf(feature.geometry)
  if (polygons.length === 0) continue
  if (DROP_CLASSES.has(featureClass)) {
    dropped.push(`${name} (${featureClass})`)
    continue
  }
  if (typeof name !== 'string') {
    unnamed.push(featureClass)
    continue
  }
  const parent = PARENT[name.toLowerCase()]
  if (!parent) {
    unnamed.push(`${name} (${featureClass})`)
    continue
  }
  parts.get(parent).push(polygons.map(oriented))
  members.get(parent).push(name)
}

if (unnamed.length > 0) {
  throw new Error(
    `${SOURCE} holds features this build does not place: ${unnamed.join(', ')}. Add each to PARENT (or to DROP_CLASSES) so the regions still tile the ocean.`,
  )
}

/*
 * One body per region from its parts, unioned.
 *
 * Clipper rather than a TopoJSON dissolve, because the source's parts do not all meet
 * exactly: the Pacific's two halves share their equatorial edge vertex for vertex, but the
 * Aegean's boundary with the rest of the Mediterranean is drawn twice, slightly differently,
 * and Natural Earth's Strait of Gibraltar polygon lies across the Mediterranean's edge rather
 * than beside it. A dissolve keeps all of that as separate polygons — a hairline where two
 * fills abut, and five scraps off Gibraltar. A union makes each region the one shape it is.
 */
const bodies = new Map(
  REGIONS.map((region) => {
    const sets = parts.get(region.id)
    return [region.id, sets.length === 1 ? sets[0].map(oriented) : clipper.union(...sets)]
  }),
)

/* ------------------------------------------------------- the water between */

/**
 * Natural Earth's marine layer names most of the ocean but not all of it: it is a layer of
 * named areas, not a partition. The western Aegean, the Saronic and Thermaic gulfs and the
 * pockets behind a hundred coasts belong to no feature in it — about 0.6% of the ocean,
 * every bit of it against a coast, which is exactly where somebody zooms in. Left alone, a
 * coloured Mediterranean would have unpainted holes around Greece.
 *
 * So the gaps are found and given to the region beside them. `sea` is the ocean itself — the
 * world minus Natural Earth's 50m land, so its edges are real coastline, with a hole for
 * every island — and what remains of it once the sixteen regions are taken out is the water
 * that has no name. Each such piece joins the region it *shares a boundary with*, and the
 * one it shares most of its boundary with when several touch it.
 *
 * Sharing a boundary is exact: Clipper hands back every output point that was an input point
 * with its original coordinates, so a piece cut from the sea along a region's edge carries
 * that region's own vertices — and the piece with most of them is the region the water opens
 * into.
 *
 * Not every piece gets one, though. Where a region's edge runs *behind* the coastline — the
 * Andaman Sea's does, off the Irrawaddy delta — the pocket in front of it is bounded by coast
 * and by two points clipping created where the two lines cross, and carries no region vertex
 * at all. So a piece with none goes to the region nearest it, within `VOID_NEAR_KM`.
 *
 * Which is also what settles the lakes. They are holes in the land layer, so they are pieces
 * of this leftover water too, and Superior, Victoria and the Aral are hundreds of kilometres
 * from any sea: no region is near them, nothing claims them, and no ocean is ever painted
 * across a lake. What the rule does claim is the odd coastal lagoon — the Szczecin and the
 * Patos — which are a few hundred metres from the sea they drain into, and which the lake
 * layer draws over the top of anyway.
 */
const VOID_MIN_KM2 = 200
const VOID_NEAR_KM = 25

const land = await source('ne_50m_land')
const world = [[[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]]
const sea = clipper.difference(world, land.features.flatMap((f) => polygonsOf(f.geometry).map(oriented)))
const covered = clipper.union(...REGIONS.map((region) => bodies.get(region.id)))
const voids = clipper.difference(sea, covered)

/** Every region's vertices, so a shared boundary can be counted, and a nearest one found. */
const vertexOwner = new Map()
/** The same vertices in one-degree cells, so "nearest region" is a lookup and not a scan. */
const cells = new Map()
const cellKey = (x, y) => `${Math.floor(x)},${Math.floor(y)}`
for (const region of REGIONS) {
  for (const polygon of bodies.get(region.id)) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        const key = `${x},${y}`
        const owners = vertexOwner.get(key)
        if (owners) owners.add(region.id)
        else vertexOwner.set(key, new Set([region.id]))
        const cell = cellKey(x, y)
        const bucket = cells.get(cell)
        if (bucket) bucket.push([x, y, region.id])
        else cells.set(cell, [[x, y, region.id]])
      }
    }
  }
}

/** The region with a vertex nearest this point, within `VOID_NEAR_KM`, or null. */
function nearestRegion(point) {
  const reach = Math.ceil(VOID_NEAR_KM / 111) + 1
  let best = null
  let bestKm = Infinity
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const [x, y, id] of cells.get(cellKey(point[0] + dx, point[1] + dy)) ?? []) {
        const distance = geoDistance(point, [x, y]) * EARTH_KM
        if (distance < bestKm) {
          bestKm = distance
          best = id
        }
      }
    }
  }
  return bestKm <= VOID_NEAR_KM ? best : null
}

const extras = new Map(REGIONS.map((region) => [region.id, []]))
const unclaimed = []
for (const polygon of voids) {
  const km2 = geoArea({ type: 'Polygon', coordinates: oriented(polygon) }) * EARTH_KM * EARTH_KM
  if (km2 < VOID_MIN_KM2) continue
  const shared = new Map()
  for (const ring of polygon) {
    for (const [x, y] of ring) {
      for (const id of vertexOwner.get(`${x},${y}`) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1)
    }
  }
  const shares = [...shared.entries()].sort((a, b) => b[1] - a[1])[0]
  /* Nearest measured from the piece's own outline, so a long pocket is judged by its mouth. */
  const near = shares ? null : polygon[0].map(nearestRegion).find((id) => id !== null)
  const claimant = shares?.[0] ?? near ?? null
  if (!claimant) {
    unclaimed.push({ km2: Math.round(km2), at: geoCentroid({ type: 'Polygon', coordinates: oriented(polygon) }) })
    continue
  }
  extras.get(claimant).push(oriented(polygon))
}

for (const region of REGIONS) {
  const found = extras.get(region.id)
  if (found.length > 0) bodies.set(region.id, clipper.union(bodies.get(region.id), found))
}

/*
 * Then the cut at 60°S. Each region keeps what lies north of the parallel, and everything
 * south of it — including the Antarctic seas, which are wholly south — becomes the Southern
 * Ocean. Union rather than concatenation because the pieces meet along the parallel and along
 * the seas' own boundaries, and a fill must not show those lines.
 */
const SOUTHERN = 'water-southern-ocean'
const southern = []
for (const region of REGIONS) {
  const body = bodies.get(region.id)
  const south = clipper.intersection(body, southOfLimit)
  if (south.length > 0) southern.push(south)
  bodies.set(region.id, region.id === SOUTHERN ? [] : clipper.difference(body, southOfLimit))
}
bodies.set(SOUTHERN, southern.length > 0 ? clipper.union(...southern) : [])

const features = []
const report = []
for (const region of REGIONS) {
  const joined = substantial(rounded(bodies.get(region.id).map(oriented)))
  if (joined.length === 0) throw new Error(`${region.name}: nothing left after joining`)

  const geometry = { type: 'MultiPolygon', coordinates: joined }
  const holes = joined.reduce((n, polygon) => n + polygon.length - 1, 0)
  const vertices = joined.reduce((n, p) => n + p.reduce((m, ring) => m + ring.length, 0), 0)
  report.push({
    name: region.name,
    parts: members.get(region.id).length,
    polygons: joined.length,
    holes,
    vertices,
    km2: Math.round(geoArea(geometry) * EARTH_KM * EARTH_KM),
  })
  features.push({ type: 'Feature', properties: { id: region.id, name: region.name, category: region.category }, geometry })
}

/* ------------------------------------------------------------------ checks */

/**
 * No point of sea may belong to two regions.
 *
 * Sampled at random over the globe rather than on the regions' own vertices: a vertex lies
 * *on* a shared boundary, and a boundary point counts as inside both of the regions that
 * meet there — Gibraltar belongs to the edge of the Atlantic and the edge of the
 * Mediterranean alike. What must not happen is two regions covering the same water, and an
 * interior point is what shows that.
 *
 * Deterministic: the same sample every run, so a failure can be reproduced.
 */
let seed = 20260918
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const overlaps = []
let sampledInWater = 0
for (let n = 0; n < 4000; n++) {
  // Uniform on the sphere, so polar water is not oversampled.
  const point = [random() * 360 - 180, (Math.asin(random() * 2 - 1) * 180) / Math.PI]
  const inside = features.filter((feature) => geoContains(feature, point)).map((f) => f.properties.name)
  if (inside.length > 0) sampledInWater++
  if (inside.length > 1) overlaps.push(`${inside.join(' / ')} at ${point[0].toFixed(3)},${point[1].toFixed(3)}`)
}
if (overlaps.length > 0) {
  throw new Error(`regions overlap: ${overlaps.slice(0, 5).join('; ')}${overlaps.length > 5 ? ` (+${overlaps.length - 5})` : ''}`)
}

/**
 * And no water may be lost, nor any invented.
 *
 * Between two bounds: the marine layer's own total, which the regions must never fall below
 * because every one of its features is folded into exactly one of them, and the ocean's — the
 * world minus the land — which they can never exceed. What sits between the two is the
 * unnamed coastal water this build gives back (plus the lakes it leaves alone), and it is
 * reported rather than asserted, because how much of it there is depends on the source.
 */
const sourceArea = marine.features
  .filter((f) => !DROP_CLASSES.has(f.properties?.featurecla ?? ''))
  .reduce((sum, f) => sum + geoArea(f) * EARTH_KM * EARTH_KM, 0)
/*
 * The water there is, as the globe minus the land. Not measured from `sea` itself: that
 * polygon is the whole world with a hole for every landmass, and a ring enclosing more than a
 * hemisphere measures as its own complement.
 */
const landArea = land.features.reduce(
  (sum, f) => sum + polygonsOf(f.geometry).reduce((n, p) => n + geoArea({ type: 'Polygon', coordinates: oriented(p) }) * EARTH_KM * EARTH_KM, 0),
  0,
)
const seaArea = 4 * Math.PI * EARTH_KM * EARTH_KM - landArea
const builtArea = report.reduce((sum, row) => sum + row.km2, 0)
const km2 = (value) => `${Math.round(value).toLocaleString('en-US')} km²`
if (builtArea < sourceArea * 0.995) {
  throw new Error(`the regions cover ${km2(builtArea)}, less than the marine layer's own ${km2(sourceArea)}: water was lost`)
}
if (builtArea > seaArea * 1.005) {
  throw new Error(
    `the regions cover ${km2(builtArea)}, more than the ${km2(seaArea)} of water there is: they overlap, or reach onto land`,
  )
}
console.log(
  `[waters] ${km2(builtArea)} of water in 16 regions: ${km2(sourceArea)} named by the marine layer, ${km2(builtArea - sourceArea)} of unnamed coastal water given to the region beside it, out of ${km2(seaArea)} of sea and lake in the world`,
)
if (unclaimed.length > 0) {
  console.log(
    `[waters] left alone: ${unclaimed.length} bodies of water touching no region — lakes, and pockets the coastline closes off (largest ${km2(Math.max(...unclaimed.map((u) => u.km2)))})`,
  )
  for (const body of [...unclaimed].sort((x, y) => y.km2 - x.km2)) {
    console.log(`    ${km2(body.km2).padStart(14)} at ${body.at[0].toFixed(2)}, ${body.at[1].toFixed(2)}`)
  }
}

const out = resolve(outDir, 'waters.geojson')
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))

const bytes = readFileSync(out).length
console.log(`[waters] ${features.length} regions from ${marine.features.length - dropped.length} marine features -> data/natural-earth/waters.geojson (${(bytes / 1024).toFixed(0)} kB)`)
console.log(`[waters] dropped as not a water region: ${dropped.join(', ')}`)
for (const row of report) {
  console.log(
    `  ${row.name.padEnd(20)} ${String(row.parts).padStart(2)} parts, ${String(row.polygons).padStart(3)} polygons, ${String(row.holes).padStart(4)} holes, ${String(row.vertices).padStart(6)} vertices, ${row.km2.toLocaleString('en-US')} km²`,
  )
}
