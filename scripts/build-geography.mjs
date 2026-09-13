/**
 * Builds the curated geographic foundation every map draws from.
 *
 * A maintenance script, NOT part of the build: it reads Natural Earth from `.cache/ne/`
 * (downloading what is missing, or everything with `--refresh`) and writes the curated
 * result into `data/natural-earth/`, which is committed. `npm run dev` / `npm run build`
 * only copy that result, so ordinary builds stay offline.
 *
 *   node scripts/build-geography.mjs
 *   node scripts/build-geography.mjs --refresh
 *
 * Source: Natural Earth via github.com/nvkelso/natural-earth-vector — public domain.
 * Island ownership also reads the maritime zones `fetch-eez.mjs` writes (Marine Regions,
 * CC BY 4.0), when they are present.
 *
 * Why one script. The maps used to be assembled by five separate scripts from three
 * different places — the World map from an older edition of Natural Earth redistributed
 * by `world-atlas`, the administrative and USA maps from the current one — each with its
 * own processing. So a lake one map drew another left out, and an island the source had
 * was on no map at all. The audit this was written against found, on the 10m maps:
 *
 *   - 2,771 of Natural Earth's minor islands — 15,357 km², 678 of them in Europe and 580 in
 *     Southeast Asia — on no map, because Natural Earth keeps them in a layer of their own
 *     and no map read it;
 *   - 1,018 of its 1,355 lakes left out by a prominence cut (`scalerank` ≤ 5), among them
 *     the Dniester liman and Laguna de Bay, and none of the 1,929 lakes in its Europe and
 *     North America supplements — Yalpuh and Kuhurlui in the Danube delta, the Molochnyi
 *     liman, the Étangs de Thau and de Vaccarès, Lake Alajuela on the Panama Canal;
 *   - every 10m topology quantised to a grid about 400 m across, which is coarser than the
 *     source: a sand spit between a lagoon and the sea, or the opening of a liman, narrower
 *     than a cell is merged or closed, and a speck of an island collapses to nothing.
 *
 * So this is the one place geography is prepared, and every map — present and future —
 * inherits the same curation:
 *
 *   1. Land comes from Natural Earth's current edition for every map: admin-0 for the World
 *      map at each resolution, admin-1 for the administrative world, and the United States'
 *      admin-1 states for the USA map, cut from that same curated set.
 *   2. Every minor island is given to the entity that owns it — by the maritime zone it lies
 *      in, or the nearest land when it lies in none — and joins that entity's geometry, on
 *      the World map and on the subdivision it lies beside on the others. Nothing is drawn by
 *      hand; every coordinate is Natural Earth's.
 *   3. The 10m topologies are quantised to ~40 m, finer than the source's own detail, so
 *      what Natural Earth draws survives.
 *   4. Inland water is one layer for every map: every Natural Earth 10m lake and both
 *      regional supplements, with a supplement's lake dropped where the main layer already
 *      draws it. Water stays its own layer, drawn over the land: borders never decide
 *      whether a place is land or water.
 *   5. Rivers likewise: every 10m river, the whole Europe supplement, and the North America
 *      supplement's major rank.
 *
 * What Natural Earth does not draw at all — the Westerschelde, the Haringvliet, the Odesa
 * limans — this cannot add without a finer source; `geography-report.json` records where
 * the named places the audit checks stand, so the gaps are known rather than guessed at.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as topojson from 'topojson-server'
import { geoArea, geoCentroid, geoContains } from 'd3-geo'
import AdmZip from 'adm-zip'
import * as shapefile from 'shapefile'
import { buildCountryTable, resolveAdmin0, resolveParent } from './country-table.mjs'
import { uniquePolygons } from './admin/geometry.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = resolve(root, '.cache/ne')
const outDir = resolve(root, 'data/natural-earth')
const REFRESH = process.argv.includes('--refresh')
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'

/**
 * Quantisation of the detailed (10m) topologies: ~40 m of longitude at the equator,
 * against the source's vertex spacing of a few hundred metres, so the grid keeps what the
 * source draws. The coarse layers are generalised by design and keep the usual 1e5.
 */
const QUANTIZATION_DETAILED = 1e6
const QUANTIZATION_COARSE = 1e5

/** Coordinates kept on the lake and river layers: 4 dp is ~11 m. */
const COORD_PRECISION = 4

/**
 * How far from land an island may be and still be given to the nearest land, when no
 * maritime zone claims it — far enough for an outlying rock like Shag Rocks, 245 km from
 * South Georgia with nothing else in the ocean around it. Beyond this it is reported
 * rather than guessed.
 */
const NEAREST_LAND_KM = 400

/**
 * An islet this close to drawn land is part of that coast, whatever zone it lies in: it
 * sits on the same reef or shore, closer than the zone boundaries are drawn.
 */
const SAME_COAST_KM = 1

/**
 * How close a claimant's own dependency must be to take an islet from it: Hong Kong's
 * islands lie in China's zone, and are Hong Kong's.
 */
const DEPENDENCY_KM = 5

mkdirSync(cacheDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function source(name) {
  const path = resolve(cacheDir, `${name}.geojson`)
  if (!existsSync(path) || REFRESH) {
    console.log(`[geography] fetching ${name}`)
    const response = await fetch(`${NE}${name}.geojson`)
    if (!response.ok) throw new Error(`${name} -> ${response.status}`)
    writeFileSync(path, await response.text())
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

/* ------------------------------------------------------------------ geometry */

const EARTH_KM = 6371
const polygonsOf = (geometry) =>
  !geometry
    ? []
    : geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

/** A polygon wound the way d3 reads it: a ring enclosing more than a hemisphere is turned round. */
function oriented(polygon) {
  return geoArea({ type: 'Polygon', coordinates: polygon }) > 2 * Math.PI
    ? polygon.map((ring) => [...ring].reverse())
    : polygon
}

const areaKm2 = (polygons) =>
  polygons.reduce((sum, p) => sum + geoArea({ type: 'Polygon', coordinates: oriented(p) }), 0) *
  EARTH_KM *
  EARTH_KM

function boundsOf(polygons) {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  }
  return [w, s, e, n]
}

/** A point inside the largest polygon: its centroid if that is inside, else one nearby that is. */
function interiorPoint(polygons) {
  let best = null
  let bestArea = -1
  for (const p of polygons) {
    const q = oriented(p)
    const a = geoArea({ type: 'Polygon', coordinates: q })
    if (a > bestArea) {
      bestArea = a
      best = q
    }
  }
  const polygon = { type: 'Polygon', coordinates: best }
  const c = geoCentroid(polygon)
  if (geoContains(polygon, c)) return c
  const ring = best[0]
  for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 60))) {
    for (const t of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const q = [c[0] + (ring[i][0] - c[0]) * t, c[1] + (ring[i][1] - c[1]) * t]
      if (geoContains(polygon, q)) return q
    }
  }
  return ring[0]
}

/** Distance in km between two lon/lat points, locally flat — only ever used within a few degrees. */
function km(lon1, lat1, lon2, lat2) {
  const dLon = ((((lon2 - lon1 + 540) % 360) + 360) % 360) - 180
  const x = dLon * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  const y = lat2 - lat1
  return Math.sqrt(x * x + y * y) * 111.195
}

/** An entity prepared for the island tests: its polygons as d3 reads them, bounds and vertices. */
function indexEntity(id, polygons) {
  const vertices = []
  for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) vertices.push(x, y)
  return { id, polygons: polygons.map(oriented), bounds: boundsOf(polygons), vertices: Float64Array.from(vertices) }
}

function withinBounds(entity, [x, y], padKm = 0) {
  const [w, s, e, n] = entity.bounds
  if (e - w > 300) return true // spans the antimeridian: always a candidate
  const padLat = padKm / 111.195
  const padLon = padKm / (111.195 * Math.max(0.05, Math.cos((y * Math.PI) / 180)))
  return x >= w - padLon && x <= e + padLon && y >= s - padLat && y <= n + padLat
}

function containsPoint(entity, point) {
  if (!withinBounds(entity, point)) return false
  return entity.polygons.some((p) => geoContains({ type: 'Polygon', coordinates: p }, point))
}

function nearest(entities, [x, y], maxKm) {
  let best = null
  for (const entity of entities) {
    if (!withinBounds(entity, [x, y], maxKm)) continue
    const v = entity.vertices
    let d = Infinity
    for (let i = 0; i < v.length; i += 2) {
      const k = km(x, y, v[i], v[i + 1])
      if (k < d) d = k
    }
    if (d <= maxKm && (!best || d < best.km)) best = { id: entity.id, km: d }
  }
  return best
}

const round = (n) => Number(n.toFixed(COORD_PRECISION))
const roundCoords = (coords) =>
  typeof coords[0] === 'number' ? [round(coords[0]), round(coords[1])] : coords.map(roundCoords)

const pointCount = (topology) => topology.arcs.reduce((sum, arc) => sum + arc.length, 0)

/* -------------------------------------------------------------------- tables */

const table = buildCountryTable()
const idByIso2 = new Map(Object.values(table.byId).filter((m) => m.iso2).map((m) => [m.iso2, m.id]))
const report = { generatedAt: new Date().toISOString(), source: 'Natural Earth (natural-earth-vector master)' }

/* --------------------------------------------------------------- World land */

/** Natural Earth admin-0 at one resolution, grouped by entity id. */
async function admin0(name) {
  const collection = await source(name)
  const groups = new Map()
  const unresolved = []
  for (const feature of collection.features) {
    const polygons = polygonsOf(feature.geometry)
    if (polygons.length === 0) continue
    const id = resolveAdmin0(feature.properties, table)
    if (!id) {
      unresolved.push(feature.properties.NAME)
      continue
    }
    // `sov`: Natural Earth's sovereignty group, which ties a dependency to its sovereign.
    const group = groups.get(id) ?? { name: feature.properties.NAME, sov: feature.properties.SOV_A3, polygons: [] }
    group.polygons.push(...polygons)
    groups.set(id, group)
  }
  return { groups, unresolved }
}

const world10 = await admin0('ne_10m_admin_0_countries')
const world50 = await admin0('ne_50m_admin_0_countries')
const world110 = await admin0('ne_110m_admin_0_countries')
report.admin0 = {
  '10m': { entities: world10.groups.size, unresolved: world10.unresolved },
  '50m': { entities: world50.groups.size, unresolved: world50.unresolved },
  '110m': { entities: world110.groups.size, unresolved: world110.unresolved },
}

/* ------------------------------------------------------- Administrative land */

const admin1Raw = await source('ne_10m_admin_1_states_provinces')
const known = (value) =>
  value !== null && value !== undefined && value !== '' && !String(value).includes('-99')
const admin1 = new Map() // adm1_code -> { props, parent, polygons }
for (const feature of admin1Raw.features) {
  if (!feature.geometry) continue
  const p = feature.properties
  const id = String(p.adm1_code)
  if (admin1.has(id)) throw new Error(`[geography] duplicate adm1_code ${id}`)
  admin1.set(id, {
    props: p,
    parent: resolveParent(p.adm0_a3, known(p.iso_a2) ? p.iso_a2 : null, table, idByIso2),
    polygons: [...polygonsOf(feature.geometry)],
  })
}

/* ------------------------------------------------------------------- Islands */

const worldIndex = [...world10.groups].map(([id, g]) => indexEntity(id, g.polygons))
/** The entities the World map actually draws — an island joins one of these. */
const drawn = new Set(world10.groups.keys())
const sovereigntyOf = (id) => world10.groups.get(id)?.sov ?? null
const subdivisionsOf = new Map()
for (const [id, s] of admin1) {
  if (!s.parent) continue
  const list = subdivisionsOf.get(s.parent) ?? []
  list.push(indexEntity(id, s.polygons))
  subdivisionsOf.set(s.parent, list)
}

const zones = []
{
  const path = resolve(root, 'public/geo/eez-territories.geojson')
  if (existsSync(path)) {
    for (const feature of JSON.parse(readFileSync(path, 'utf8')).features) {
      const { id, sovereign } = feature.properties
      /*
       * The zone's territory where the World map draws it, else its sovereign — Natural
       * Earth draws Guadeloupe inside France, so Guadeloupe's islets are France's there —
       * and only then an entity drawn nowhere.
       */
      const owner = drawn.has(id)
        ? id
        : drawn.has(sovereign)
          ? sovereign
          : table.byId[id]
            ? id
            : table.byId[sovereign]
              ? sovereign
              : null
      if (!owner) continue
      // Outer rings only: a zone encloses the islands it is drawn around, as holes or not.
      const outers = polygonsOf(feature.geometry).map((p) => [p[0]])
      zones.push({ ...indexEntity(owner, outers), zone: id, sovereign })
    }
  } else {
    console.warn('[geography] no maritime zones (run fetch-eez.mjs) — islands go to the nearest land')
  }
}

const islandsRaw = await source('ne_10m_minor_islands')
const islandReport = {
  total: 0,
  alreadyLand: 0,
  assigned: 0,
  via: { sameCoast: 0, zone: 0, zoneOverlap: 0, dependency: 0, nearestLand: 0 },
  unassigned: [],
  notOnAdministrativeMap: [],
  zoneDisagreesWithNearestLand: [],
  byOwner: {},
  areaKm2: 0,
}
for (const feature of islandsRaw.features) {
  const polygons = polygonsOf(feature.geometry)
  if (polygons.length === 0) continue
  islandReport.total++
  const point = interiorPoint(polygons)
  if (worldIndex.some((entity) => containsPoint(entity, point))) {
    islandReport.alreadyLand++
    continue
  }

  const claiming = zones.filter((z) => containsPoint(z, point))
  const claims = [...new Set(claiming.map((z) => z.id))]
  const near = nearest(worldIndex, point, NEAREST_LAND_KM)
  let owner = null
  if (near && near.km <= SAME_COAST_KM) {
    owner = near.id
    islandReport.via.sameCoast++
  } else if (claims.length >= 1) {
    if (claims.length === 1) {
      owner = claims[0]
      islandReport.via.zone++
    } else {
      // Overlapping claims: the claimant whose land is nearest.
      const ranked = claims
        .map((id) => ({ id, d: nearest(worldIndex.filter((e) => e.id === id), point, 2000)?.km ?? Infinity }))
        .sort((a, b) => a.d - b.d)
      owner = ranked[0].id
      islandReport.via.zoneOverlap++
    }
    // A claimant's own dependency, right beside the islet, is where it belongs.
    const sov = sovereigntyOf(owner)
    if (near && near.id !== owner && near.km <= DEPENDENCY_KM && sov && sovereigntyOf(near.id) === sov) {
      owner = near.id
      islandReport.via.dependency++
    }
  } else if (near) {
    owner = near.id
    islandReport.via.nearestLand++
  }

  const at = point.map((v) => Number(v.toFixed(4)))
  const area = areaKm2(polygons)
  if (!owner) {
    islandReport.unassigned.push({ at, areaKm2: Number(area.toFixed(3)), nearest: near ?? null })
    continue
  }
  if (near && near.id !== owner && near.km < 5) {
    islandReport.zoneDisagreesWithNearestLand.push({ at, owner, nearestLand: near.id, km: Number(near.km.toFixed(1)) })
  }

  // The World map: the owner's own geometry.
  const group = world10.groups.get(owner) ?? { name: table.byId[owner]?.name ?? owner, polygons: [] }
  group.polygons.push(...polygons)
  world10.groups.set(owner, group)

  /*
   * The administrative world (and so the USA map): the nearest subdivision of the owner —
   * or of the zone's own territory or sovereign, where Natural Earth files its subdivisions
   * under a different unit than the country map draws (Tokelau's under New Zealand's).
   */
  const units = new Set([owner, ...claiming.flatMap((z) => [z.zone, z.sovereign])])
  const candidates = [...units].flatMap((unit) => subdivisionsOf.get(unit) ?? [])
  const subdivision = nearest(candidates, point, 20000)
  if (subdivision) admin1.get(subdivision.id).polygons.push(...polygons)
  else islandReport.notOnAdministrativeMap.push({ at, owner })

  islandReport.assigned++
  islandReport.areaKm2 += area
  islandReport.byOwner[owner] = (islandReport.byOwner[owner] ?? 0) + 1
}
islandReport.areaKm2 = Math.round(islandReport.areaKm2)
report.islands = islandReport

/* ------------------------------------------------------------ The topologies */

function worldTopology(groups, quantization) {
  const features = [...groups]
    .map(([id, g]) => ({
      type: 'Feature',
      id,
      properties: { name: g.name },
      geometry: { type: 'MultiPolygon', coordinates: g.polygons },
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return topojson.topology({ countries: { type: 'FeatureCollection', features } }, quantization)
}

const outputs = {}
function write(name, value) {
  const text = JSON.stringify(value)
  writeFileSync(resolve(outDir, name), text)
  outputs[name] = `${(text.length / 1e6).toFixed(2)} MB`
}

for (const [detail, world, q] of [
  ['10m', world10, QUANTIZATION_DETAILED],
  ['50m', world50, QUANTIZATION_COARSE],
  ['110m', world110, QUANTIZATION_COARSE],
]) {
  const topology = worldTopology(world.groups, q)
  write(`countries-${detail}.json`, topology)
  report.admin0[detail].points = pointCount(topology)
}

/*
 * The Modern Administrative World: Natural Earth's admin-1 units, islands joined, handed to
 * the curated country table (`scripts/admin/`), which decides each country's level and
 * writes the map into `data/admin/`. A copy of the units is left in `.cache/` so the table
 * can be rebuilt on its own: `node scripts/admin/build-admin.mjs`.
 */
{
  const KEEP = [
    'adm1_code', 'iso_3166_2', 'name', 'name_en', 'type', 'type_en', 'code_hasc', 'postal', 'wikidataid',
    'region', 'region_sub', 'region_cod', 'geonunit', 'adm0_a3', 'iso_a2', 'admin', 'ne_id',
  ]
  const units = [...admin1].map(([id, s]) => ({
    id,
    parent: s.parent,
    props: Object.fromEntries(KEEP.map((k) => [k, s.props[k] ?? null])),
    polygons: s.polygons,
  }))
  writeFileSync(resolve(root, '.cache/admin-units.json'), JSON.stringify(units))
  report.admin1 = { naturalEarthUnits: units.length }
  const { buildAdministrative } = await import('./admin/build-admin.mjs')
  const admin = await buildAdministrative({ root, units, table, refresh: REFRESH })
  report.administrative = { totals: admin.totals, problems: admin.problems.length }
}

/* -------------------------------------------------------------- USA states */

/** Area-weighted centroid of the largest ring, for a state's representative point. */
function representativePoint(polygons) {
  let bestArea = -Infinity
  let best = null
  for (const polygon of polygons) {
    const ring = polygon[0]
    if (!ring || ring.length < 4) continue
    let area = 0
    let cx = 0
    let cy = 0
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      area += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    area /= 2
    if (Math.abs(area) < 1e-12) continue
    // Largest ring wins: a state's representative point belongs on its mainland.
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      best = [cx / (6 * area), cy / (6 * area)]
    }
  }
  return best
}

/**
 * The territories, from the file the Official USA Administrative Map draws its states from:
 * the Census Bureau's 2024 cartographic boundary file of states and state-equivalents,
 * 1:500,000. Same file, same polygons, so the two maps draw Puerto Rico, the Virgin Islands,
 * Guam, the Northern Marianas and American Samoa with the same coastline.
 */
const CENSUS_STATES = {
  name: 'cb_2024_us_state_500k',
  url: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip',
  cache: resolve(root, '.cache/census/cb_2024_us_state_500k'),
}

async function censusStates() {
  const shp = resolve(CENSUS_STATES.cache, `${CENSUS_STATES.name}.shp`)
  if (!existsSync(shp) || REFRESH) {
    mkdirSync(CENSUS_STATES.cache, { recursive: true })
    console.log(`[geography] fetching ${CENSUS_STATES.url}`)
    const response = await fetch(CENSUS_STATES.url)
    if (!response.ok) throw new Error(`${CENSUS_STATES.url} -> ${response.status}`)
    new AdmZip(Buffer.from(await response.arrayBuffer())).extractAllTo(CENSUS_STATES.cache, true)
  }
  const collection = await shapefile.read(shp, resolve(CENSUS_STATES.cache, `${CENSUS_STATES.name}.dbf`), {
    encoding: 'utf-8',
  })
  return collection.features.filter((f) => f.geometry)
}

/** Each territory as one entity, keyed by its Census state FIPS code. */
const TERRITORIES = {
  '72': { id: 'US-PR', name: 'Puerto Rico', officialName: 'Commonwealth of Puerto Rico', subregion: 'Caribbean territories' },
  '78': { id: 'US-VI', name: 'U.S. Virgin Islands', officialName: 'United States Virgin Islands', subregion: 'Caribbean territories' },
  '66': { id: 'US-GU', name: 'Guam', officialName: 'Guam', subregion: 'Pacific territories' },
  '69': { id: 'US-MP', name: 'Northern Mariana Islands', officialName: 'Commonwealth of the Northern Mariana Islands', subregion: 'Pacific territories' },
  '60': { id: 'US-AS', name: 'American Samoa', officialName: 'American Samoa', subregion: 'Pacific territories' },
}

/**
 * The Minor Outlying Islands, which no Census file draws: from the USGS Global Islands
 * database, version 3 (Sayre 2023, https://doi.org/10.5066/P91ZCSGM) — shorelines traced
 * from 30 m Landsat imagery, every islet of an atoll a polygon of its own, released by the
 * USGS without access or use constraints. Asked of its published feature service one island
 * at a time, by a box around the island, in all three island layers (big, small and very
 * small), so an atoll keeps every islet the source has. Ids are ISO 3166-2:UM.
 *
 * Kingman Reef is asked too. It is a reef awash, and the source has no dry land there, so it
 * is reported as omitted rather than drawn as something the data does not show.
 */
const GLOBAL_ISLANDS = 'https://data-gis.unep-wcmc.org/server/rest/services/Global_Islands/FeatureServer'
const OUTLYING_ISLANDS = [
  { id: 'UM-81', name: 'Baker Island', box: [-176.55, 0.13, -176.4, 0.28], subregion: 'Pacific remote islands' },
  { id: 'UM-84', name: 'Howland Island', box: [-176.7, 0.73, -176.58, 0.87], subregion: 'Pacific remote islands' },
  { id: 'UM-86', name: 'Jarvis Island', box: [-160.1, -0.45, -159.95, -0.31], subregion: 'Pacific remote islands' },
  { id: 'UM-67', name: 'Johnston Atoll', box: [-169.65, 16.65, -169.4, 16.85], subregion: 'Pacific remote islands' },
  { id: 'UM-89', name: 'Kingman Reef', box: [-162.6, 6.28, -162.2, 6.52], subregion: 'Pacific remote islands' },
  { id: 'UM-71', name: 'Midway Atoll', box: [-177.45, 28.15, -177.25, 28.3], subregion: 'Pacific remote islands' },
  { id: 'UM-95', name: 'Palmyra Atoll', box: [-162.2, 5.8, -161.95, 5.95], subregion: 'Pacific remote islands' },
  { id: 'UM-79', name: 'Wake Island', box: [166.55, 19.22, 166.7, 19.36], subregion: 'Pacific remote islands' },
  { id: 'UM-76', name: 'Navassa Island', box: [-75.1, 18.35, -74.95, 18.46], subregion: 'Caribbean territories' },
]

async function globalIslands(island) {
  const path = resolve(root, '.cache/usgs/global-islands', `${island.id}.geojson`)
  if (!existsSync(path) || REFRESH) {
    mkdirSync(dirname(path), { recursive: true })
    const features = []
    for (const layer of [0, 1, 2]) {
      const query = new URLSearchParams({
        where: '1=1',
        geometry: island.box.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'name_usgso,name_wcmci,area_geode',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
      })
      const response = await fetch(`${GLOBAL_ISLANDS}/${layer}/query?${query}`)
      if (!response.ok) throw new Error(`Global Islands layer ${layer} for ${island.name} -> ${response.status}`)
      const json = await response.json()
      if (json.error) throw new Error(`Global Islands layer ${layer} for ${island.name}: ${JSON.stringify(json.error)}`)
      if (json.exceededTransferLimit || json.properties?.exceededTransferLimit) {
        throw new Error(`Global Islands layer ${layer} for ${island.name}: more polygons than one request returns`)
      }
      features.push(...(json.features ?? []))
    }
    writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }))
  }
  return JSON.parse(readFileSync(path, 'utf8')).features
}

{
  const features = []
  const meta = {}
  for (const [, s] of admin1) {
    const p = s.props
    if (p.adm0_a3 !== 'USA') continue
    const id = String(p.iso_3166_2 || `US-${p.postal}`)
    const point = representativePoint(s.polygons) ?? [0, 0]
    features.push({
      type: 'Feature',
      id,
      properties: { id, name: p.name, code: p.postal },
      geometry: { type: 'MultiPolygon', coordinates: s.polygons },
    })
    meta[id] = {
      id,
      // A state is not a country, and this is the field the flag library reads.
      iso2: null,
      code: p.postal,
      numeric: null,
      name: p.name,
      officialName: p.name,
      // The US Census regions and divisions, which is what "region" honestly means for a state.
      region: p.region || 'United States',
      subregion: p.region_sub || p.region || 'United States',
      independent: false,
      lat: Number(point[1].toFixed(4)),
      lng: Number(point[0].toFixed(4)),
    }
  }
  const stateCount = features.length

  /** One more entity, beside the states and in the same shape as them. */
  const add = (id, polygons, entity) => {
    if (meta[id]) throw new Error(`[geography] ${id} is on the USA map twice`)
    const point = representativePoint(polygons) ?? [0, 0]
    features.push({
      type: 'Feature',
      id,
      properties: { id, name: entity.name, code: entity.code },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    })
    meta[id] = {
      id,
      iso2: null,
      code: entity.code,
      numeric: null,
      name: entity.name,
      officialName: entity.officialName,
      kind: entity.kind,
      region: 'Territories',
      subregion: entity.subregion,
      independent: false,
      lat: Number(point[1].toFixed(4)),
      lng: Number(point[0].toFixed(4)),
      source: entity.source,
    }
  }

  /*
   * The territories, each one entity as a state is. Puerto Rico is one Puerto Rico here, not
   * its 78 municipios — those belong to the Official USA Administrative Map, which draws the
   * same Census polygons divided into its counties and subdivisions.
   */
  const census = await censusStates()
  for (const [fips, territory] of Object.entries(TERRITORIES)) {
    const feature = census.find((f) => f.properties.STATEFP === fips)
    if (!feature) throw new Error(`[geography] ${CENSUS_STATES.name} has no ${territory.name} (FIPS ${fips})`)
    const p = feature.properties
    add(territory.id, uniquePolygons(polygonsOf(feature.geometry)), {
      code: p.STUSPS,
      name: territory.name,
      officialName: territory.officialName,
      kind: 'Territory',
      subregion: territory.subregion,
      source: {
        dataset: `U.S. Census Bureau, ${CENSUS_STATES.name}, Cartographic Boundary File, States, 2024 (1:500,000)`,
        ids: [p.GEOID],
        geoid: p.GEOID,
        vintage: 2024,
        codes: { STATEFP: p.STATEFP, STUSPS: p.STUSPS, GEOID: p.GEOID },
        landKm2: Number((p.ALAND / 1e6).toFixed(2)),
        waterKm2: Number((p.AWATER / 1e6).toFixed(2)),
        iso31662: territory.id,
      },
    })
  }

  /*
   * The Minor Outlying Islands, each atoll or island one entity with every islet the source
   * draws. A polygon reaching outside the island's box would be some other land the query
   * caught, so it stops the build rather than joining the island.
   */
  const outlying = []
  const omitted = []
  for (const island of OUTLYING_ISLANDS) {
    const [west, south, east, north] = island.box
    const found = await globalIslands(island)
    const polygons = uniquePolygons(found.flatMap((f) => polygonsOf(f.geometry)).map(oriented))
    for (const polygon of polygons) {
      for (const [x, y] of polygon[0]) {
        if (x < west || x > east || y < south || y > north) {
          throw new Error(`[geography] ${island.name}: a Global Islands polygon reaches outside its box, at ${x}, ${y}`)
        }
      }
    }
    if (polygons.length === 0) {
      omitted.push({ id: island.id, name: island.name, reason: 'no land in the USGS Global Islands database' })
      continue
    }
    const km2 = areaKm2(polygons)
    add(island.id, polygons, {
      code: island.id,
      name: island.name,
      officialName: island.name,
      kind: 'Minor Outlying Island',
      subregion: island.subregion,
      source: {
        dataset: 'U.S. Geological Survey, Global Islands, version 3 (Sayre 2023), 30 m Landsat shoreline',
        ids: [island.id],
        vintage: 2023,
        codes: { 'ISO 3166-2': island.id },
        landKm2: Number(km2.toFixed(2)),
        iso31662: island.id,
      },
    })
    outlying.push({ id: island.id, name: island.name, polygons: polygons.length, km2: Number(km2.toFixed(3)) })
  }

  /*
   * An islet smaller than the topology's grid cannot be drawn by it. Quantised, its ring
   * collapses to one or two points, which d3 reads as a ring round the rest of the globe —
   * Midway's source has 303 islets, 230 of them smaller than one grid cell there (~335 m²).
   * So, for the territories and islands, each polygon is snapped to the grid TopoJSON is
   * about to use, exactly as it will snap it, and one whose outer ring does not keep three
   * distinct points wound the way the source winds it is left out and counted. The states
   * are Natural Earth's and untouched.
   */
  const bbox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const f of features) {
    for (const polygon of f.geometry.coordinates) {
      for (const [x, y] of polygon[0]) {
        if (x < bbox[0]) bbox[0] = x
        if (y < bbox[1]) bbox[1] = y
        if (x > bbox[2]) bbox[2] = x
        if (y > bbox[3]) bbox[3] = y
      }
    }
  }
  const kx = (QUANTIZATION_DETAILED - 1) / (bbox[2] - bbox[0])
  const ky = (QUANTIZATION_DETAILED - 1) / (bbox[3] - bbox[1])
  const twiceArea = (ring) => {
    let sum = 0
    for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
    return sum
  }
  const holds = (ring) => {
    const snapped = []
    for (const [x, y] of ring) {
      const q = [Math.round((x - bbox[0]) * kx), Math.round((y - bbox[1]) * ky)]
      const last = snapped[snapped.length - 1]
      if (!last || last[0] !== q[0] || last[1] !== q[1]) snapped.push(q)
    }
    const area = twiceArea(snapped)
    return new Set(snapped.map(String)).size >= 3 && area !== 0 && Math.sign(area) === Math.sign(twiceArea(ring))
  }
  const belowGrid = {}
  for (const f of features) {
    if (!meta[f.id]?.source) continue
    const kept = f.geometry.coordinates
      .filter((polygon) => holds(polygon[0]))
      .map((polygon) => [polygon[0], ...polygon.slice(1).filter(holds)])
    const dropped = f.geometry.coordinates.length - kept.length
    if (kept.length === 0) throw new Error(`[geography] ${f.id}: every polygon is smaller than the map's grid`)
    if (dropped) belowGrid[f.id] = dropped
    f.geometry.coordinates = kept
  }
  for (const island of outlying) island.drawn = island.polygons - (belowGrid[island.id] ?? 0)

  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
  const topology = topojson.topology(
    { states: { type: 'FeatureCollection', features } },
    QUANTIZATION_DETAILED,
  )
  // The filter above is only right if it snapped to the grid TopoJSON chose.
  const [tx, ty] = topology.transform.translate
  if (Math.abs(tx - bbox[0]) > 1e-9 || Math.abs(ty - bbox[1]) > 1e-9 || Math.abs(topology.transform.scale[0] - 1 / kx) > 1e-12) {
    throw new Error(`[geography] the USA topology's grid is not the one the islet filter assumed`)
  }
  write('us-states-10m.json', topology)
  write('us-states-meta.json', meta)
  report.usStates = {
    entities: features.length,
    states: stateCount,
    territories: Object.keys(TERRITORIES).length,
    outlyingIslands: outlying,
    omitted,
    polygonsBelowGrid: belowGrid,
    points: pointCount(topology),
  }
}

/* -------------------------------------------------------------- Inland water */

function lakeFeature(feature) {
  return {
    type: 'Feature',
    properties: { name: feature.properties.name ?? feature.properties.name_en ?? null, scalerank: feature.properties.scalerank ?? 0 },
    geometry: { type: feature.geometry.type, coordinates: roundCoords(feature.geometry.coordinates) },
  }
}

{
  const main = (await source('ne_10m_lakes')).features.filter((f) => f.geometry)
  const mainIndex = main.map((f, i) => indexEntity(String(i), polygonsOf(f.geometry)))
  const kept = [...main]
  const lakeReport = { main: main.length }
  for (const [label, name] of [
    ['europe', 'ne_10m_lakes_europe'],
    ['northAmerica', 'ne_10m_lakes_north_america'],
  ]) {
    let added = 0
    let duplicate = 0
    for (const f of (await source(name)).features) {
      if (!f.geometry) continue
      // A supplement adds detail; where the main layer already draws the lake, it wins.
      const point = interiorPoint(polygonsOf(f.geometry))
      if (mainIndex.some((lake) => containsPoint(lake, point))) {
        duplicate++
        continue
      }
      kept.push(f)
      added++
    }
    lakeReport[label] = { added, alreadyInMainLayer: duplicate }
  }
  const features = kept
    .map(lakeFeature)
    .sort((a, b) => a.properties.scalerank - b.properties.scalerank || (a.properties.name ?? '').localeCompare(b.properties.name ?? ''))
  write('lakes-10m.geojson', { type: 'FeatureCollection', features })
  lakeReport.total = features.length
  report.lakes10m = lakeReport

  const lakes50 = (await source('ne_50m_lakes')).features.filter((f) => f.geometry).map(lakeFeature)
  write('lakes-50m.geojson', { type: 'FeatureCollection', features: lakes50 })
  report.lakes50m = { total: lakes50.length }
}

/* -------------------------------------------------------------------- Rivers */

function riverFeature(feature) {
  return {
    type: 'Feature',
    properties: { name: feature.properties.name ?? feature.properties.name_en ?? null, scalerank: feature.properties.scalerank ?? 0 },
    geometry: { type: feature.geometry.type, coordinates: roundCoords(feature.geometry.coordinates) },
  }
}
const isLine = (f) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')

{
  /*
   * The North America supplement carries 4,878 rivers — 3,814 of them in its two lowest
   * ranks, which are creeks at this scale and would draw the continent many times denser
   * than the rest of the world. Its major rank joins; the rest does not.
   */
  const main = (await source('ne_10m_rivers_lake_centerlines')).features.filter(isLine)
  const europe = (await source('ne_10m_rivers_europe')).features.filter(isLine)
  const northAmerica = (await source('ne_10m_rivers_north_america')).features
    .filter(isLine)
    .filter((f) => f.properties.scalerank <= 10)
  const features = [...main, ...europe, ...northAmerica].map(riverFeature)
  write('rivers-10m.geojson', { type: 'FeatureCollection', features })
  report.rivers10m = { main: main.length, europe: europe.length, northAmerica: northAmerica.length }

  const rivers50 = (await source('ne_50m_rivers_lake_centerlines')).features.filter(isLine).map(riverFeature)
  write('rivers-50m.geojson', { type: 'FeatureCollection', features: rivers50 })
  report.rivers50m = { total: rivers50.length }
}

/* ------------------------------------------------------------ Named places */

/**
 * Where the audit's named places stand: water (the coast leaves it open, or the lake layer
 * draws it) or land. Recorded, never used to change anything — this is how a gap Natural
 * Earth does not fill stays visible instead of being papered over by hand.
 */
{
  const PLACES = [
    ['Danube delta: Razim lagoon', 28.95, 44.88], ['Danube: Lake Yalpuh', 28.6, 45.42],
    ['Danube: Lake Kahul', 28.39, 45.47], ['Sasyk lagoon', 29.63, 45.66], ['Dniester liman', 30.28, 46.24],
    ['Khadzhibey liman', 30.56, 46.62], ['Kuyalnyk liman', 30.67, 46.66], ['Tylihul liman', 31.12, 46.83],
    ['Dnieper-Bug estuary', 31.9, 46.58], ['Molochnyi liman', 35.35, 46.55],
    ['NL IJsselmeer', 5.4, 52.8], ['NL Oosterschelde', 3.95, 51.6], ['NL Westerschelde', 3.8, 51.41],
    ['NL Haringvliet', 4.2, 51.79], ['NL Grevelingen', 3.95, 51.75], ['NL Wadden Sea', 5.2, 53.2],
    ['FR Etang de Berre', 5.1, 43.46], ['FR Etang de Thau', 3.6, 43.41], ['FR Bassin d\'Arcachon', -1.17, 44.68],
    ['FR Etang de Vaccares', 4.6, 43.53], ['FR Lac de Grand-Lieu', -1.67, 47.09], ['FR Gironde estuary', -0.85, 45.4],
    ['PA Gatun Lake', -79.85, 9.2], ['PA Lake Alajuela', -79.58, 9.22],
    ['KH Tonle Sap', 104.0, 12.9], ['TH Songkhla lake', 100.4, 7.2], ['PH Laguna de Bay', 121.25, 14.35],
    ['IT Venice lagoon', 12.3, 45.42], ['LT Curonian lagoon', 21.1, 55.3], ['EG Lake Manzala', 31.95, 31.25],
    ['IN Chilika lake', 85.35, 19.7], ['US Pamlico Sound', -76.0, 35.3], ['US Lake Pontchartrain', -90.1, 30.2],
  ]
  const curatedLand = [...world10.groups].map(([id, g]) => indexEntity(id, g.polygons))
  const lakes = JSON.parse(readFileSync(resolve(outDir, 'lakes-10m.geojson'), 'utf8')).features.map((f, i) =>
    Object.assign(indexEntity(String(i), polygonsOf(f.geometry)), { name: f.properties.name }),
  )
  report.places = PLACES.map(([name, lon, lat]) => {
    const point = [lon, lat]
    const lake = lakes.find((l) => containsPoint(l, point))
    const land = curatedLand.some((e) => containsPoint(e, point))
    return { name, water: !land || !!lake, via: !land ? 'coast' : lake ? `lake: ${lake.name ?? 'unnamed'}` : null }
  })
}

report.outputs = outputs
writeFileSync(resolve(outDir, 'geography-report.json'), JSON.stringify(report, null, 1))

const places = report.places
console.log(
  `[geography] countries 10m ${report.admin0['10m'].entities} entities, ${report.admin0['10m'].points.toLocaleString()} points` +
    (report.admin0['10m'].unresolved.length ? `; unresolved: ${report.admin0['10m'].unresolved.join(', ')}` : ''),
)
console.log(
  `[geography] administrative world from ${report.admin1.naturalEarthUnits} Natural Earth units: ` +
    `curated ${report.administrative.totals.curated}, detailed ${report.administrative.totals.detailed}, ` +
    `maximum ${report.administrative.totals.maximum} units; ${report.administrative.problems} problems (data/admin/report.json)`,
)
console.log(
  `[geography] USA States: ${report.usStates.states} states, ${report.usStates.territories} territories, ` +
    `${report.usStates.outlyingIslands.length} outlying islands` +
    (report.usStates.omitted.length ? ` (omitted: ${report.usStates.omitted.map((o) => `${o.name}, ${o.reason}`).join('; ')})` : '') +
    `, ${report.usStates.points.toLocaleString()} points`,
)
console.log(
  `[geography] minor islands: ${islandReport.assigned} of ${islandReport.total} joined their owners ` +
    `(${islandReport.areaKm2.toLocaleString()} km²; zone ${islandReport.via.zone}, overlap ${islandReport.via.zoneOverlap}, ` +
    `nearest land ${islandReport.via.nearestLand}); ${islandReport.alreadyLand} already land; ` +
    `${islandReport.unassigned.length} unassigned; ${islandReport.notOnAdministrativeMap.length} without a subdivision`,
)
console.log(
  `[geography] lakes 10m ${report.lakes10m.total} (main ${report.lakes10m.main}, Europe +${report.lakes10m.europe.added}, ` +
    `North America +${report.lakes10m.northAmerica.added}); rivers 10m ${report.rivers10m.main + report.rivers10m.europe + report.rivers10m.northAmerica}`,
)
console.log(
  `[geography] named places: ${places.filter((p) => p.water).length} of ${places.length} water; still land: ` +
    places.filter((p) => !p.water).map((p) => p.name).join('; '),
)
console.log(`[geography] wrote ${Object.entries(outputs).map(([k, v]) => `${k} ${v}`).join(', ')}`)
