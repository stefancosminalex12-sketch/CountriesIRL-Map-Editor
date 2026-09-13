/**
 * Builds the Official USA Administrative Map from official U.S. government data.
 *
 *   node --max-old-space-size=12000 scripts/usa/build-usa.mjs [--refresh]
 *
 * A maintenance script like `build-geography.mjs`: it downloads its sources into
 * `.cache/census/` and `.cache/usgs/` (once, or again with `--refresh`) and writes the map
 * into `data/usa-official/`, which is committed; ordinary builds only copy it.
 *
 * ## Sources (all public domain — works of the U.S. Government, 17 U.S.C. §105)
 *
 *   - U.S. Census Bureau cartographic boundary files, 2024, 1:500,000: states and
 *     state-equivalents, counties and county-equivalents, county subdivisions. The Census
 *     Bureau's generalisation of TIGER/Line for display, clipped to the shoreline.
 *   - USGS Small-scale Dataset, 1:1,000,000-scale hydrography: waterbodies and streams. The
 *     cartographic boundary files are clipped at the ocean and the Great Lakes but keep inland
 *     water — Great Salt Lake, Okeechobee, Pontchartrain are county land there — so the lakes
 *     are drawn over the land from USGS, as every map in the editor draws its lakes.
 *
 * ## Levels (one topology each, loaded only when chosen)
 *
 *   states        the 50 states, the District of Columbia and the five territories (56)
 *   counties      counties and county-equivalents: parishes, boroughs, census areas,
 *                 independent cities, municipios, Connecticut's planning regions (3,235)
 *   subdivisions  county subdivisions where they are legal units — towns, townships,
 *                 boroughs, barrios — and the county itself where a state's subdivisions are
 *                 only statistical (census county divisions, unorganized territory, census
 *                 subareas). Statistical areas are never shown as if they were administrative.
 *
 * Each entity is identified by its Census GEOID (`county-06037`), so an id is stable across
 * vintages and a county keeps the same id at every level it appears in. Its core entry — name,
 * kind, parent, region — travels with the geometry; its codes and source are a separate file
 * the inspector fetches when it needs them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import * as tar from 'tar'
import * as shapefile from 'shapefile'
import * as topojson from 'topojson-server'
import { geoContains } from 'd3-geo'
import { areaKm2, dissolve, indexed, contains, interiorPoint, km, oriented, polygonsOf, uniquePolygons } from '../admin/geometry.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REFRESH = process.argv.includes('--refresh')
const outDir = resolve(root, 'data/usa-official')
const QUANTIZATION = 1e6
const VINTAGE = 2024

/* ------------------------------------------------------------------ sources */

const CENSUS = (name) => ({
  name,
  url: `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp/${name}.zip`,
  cache: resolve(root, '.cache/census', name),
  kind: 'zip',
})

export const SOURCES = {
  state: { ...CENSUS(`cb_${VINTAGE}_us_state_500k`), title: 'Cartographic Boundary File, States', scale: '1:500,000' },
  county: { ...CENSUS(`cb_${VINTAGE}_us_county_500k`), title: 'Cartographic Boundary File, Counties', scale: '1:500,000' },
  cousub: { ...CENSUS(`cb_${VINTAGE}_us_cousub_500k`), title: 'Cartographic Boundary File, County Subdivisions', scale: '1:500,000' },
  waterbodies: {
    name: 'wtrbdyp010g',
    url: 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Small-scale/data/Hydrography/wtrbdyp010g.shp_nt00886.tar.gz',
    cache: resolve(root, '.cache/usgs'),
    kind: 'tar',
    title: 'USGS Small-scale Dataset, 1:1,000,000-Scale Waterbodies',
    scale: '1:1,000,000',
  },
  streams: {
    name: 'streaml010g',
    url: 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Small-scale/data/Hydrography/streaml010g.shp_nt00885.tar.gz',
    cache: resolve(root, '.cache/usgs'),
    kind: 'tar',
    title: 'USGS Small-scale Dataset, 1:1,000,000-Scale Streams',
    scale: '1:1,000,000',
  },
}

async function load(source) {
  const shp = resolve(source.cache, `${source.name}.shp`)
  if (!existsSync(shp) || REFRESH) {
    mkdirSync(source.cache, { recursive: true })
    console.log(`[usa] fetching ${source.url}`)
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`${source.url} -> ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (source.kind === 'zip') new AdmZip(bytes).extractAllTo(source.cache, true)
    else {
      const archive = resolve(source.cache, `${source.name}.tar.gz`)
      writeFileSync(archive, bytes)
      await tar.x({ file: archive, cwd: source.cache })
    }
  }
  const collection = await shapefile.read(shp, resolve(source.cache, `${source.name}.dbf`), { encoding: 'utf-8' })
  return collection.features.filter((f) => f.geometry)
}

/* ------------------------------------------------------------- vocabulary */

/** Census Regions and Divisions of the United States, by state FIPS code. */
const DIVISIONS = {
  'New England': { region: 'Northeast', states: ['09', '23', '25', '33', '44', '50'] },
  'Middle Atlantic': { region: 'Northeast', states: ['34', '36', '42'] },
  'East North Central': { region: 'Midwest', states: ['17', '18', '26', '39', '55'] },
  'West North Central': { region: 'Midwest', states: ['19', '20', '27', '29', '31', '38', '46'] },
  'South Atlantic': { region: 'South', states: ['10', '11', '12', '13', '24', '37', '45', '51', '54'] },
  'East South Central': { region: 'South', states: ['01', '21', '28', '47'] },
  'West South Central': { region: 'South', states: ['05', '22', '40', '48'] },
  Mountain: { region: 'West', states: ['04', '08', '16', '30', '32', '35', '49', '56'] },
  Pacific: { region: 'West', states: ['02', '06', '15', '41', '53'] },
  // Not a Census division: the Island Areas and Puerto Rico sit outside the four regions.
  'Caribbean territories': { region: 'Territories', states: ['72', '78'] },
  'Pacific territories': { region: 'Territories', states: ['60', '66', '69'] },
}
const divisionOf = {}
for (const [division, { region, states }] of Object.entries(DIVISIONS)) for (const s of states) divisionOf[s] = { division, region }

const TERRITORY_NAMES = {
  '72': 'Commonwealth of Puerto Rico',
  '69': 'Commonwealth of the Northern Mariana Islands',
  '66': 'Guam',
  '60': 'American Samoa',
  '78': 'United States Virgin Islands',
}
const stateKind = (fips) => (fips === '11' ? 'Federal district' : TERRITORY_NAMES[fips] ? 'Territory' : 'State')

/** County-equivalent types by Census LSAD code. */
const COUNTY_LSAD = {
  '03': 'City and borough',
  '04': 'Borough',
  '05': 'Census area (statistical county-equivalent)',
  '06': 'County',
  '07': 'District',
  '10': 'Island',
  '12': 'Municipality',
  '13': 'Municipio',
  '15': 'Parish',
  '25': 'Independent city',
  PL: 'Planning region (county-equivalent)',
}
const countyKind = (p) => {
  if (p.LSAD !== '00') return COUNTY_LSAD[p.LSAD] ?? 'County-equivalent'
  if (p.STATEFP === '11') return 'Federal district (county-equivalent)'
  if (p.STATEFP === '66') return 'Territory (county-equivalent)'
  if (p.STATEFP === '60') return 'Island'
  if (p.GEOID === '32510') return 'Consolidated city'
  return 'County-equivalent'
}

/** County subdivision types by Census LSAD code; the statistical ones are merged away. */
const COUSUB_LSAD = {
  '20': 'Barrio',
  '21': 'Borough',
  '24': 'Subdistrict',
  '25': 'City',
  '26': 'County',
  '27': 'District',
  '28': 'District',
  '29': 'Precinct',
  '30': 'Precinct',
  '31': 'Gore',
  '32': 'Grant',
  '36': 'Location',
  '37': 'Municipality',
  '39': 'Plantation',
  '41': 'Barrio-pueblo',
  '42': 'Purchase',
  '43': 'Town',
  '44': 'Township',
  '45': 'Township',
  '47': 'Village',
  '49': 'Charter township',
  '86': 'Reservation',
}
/** Census county divisions, census subareas, unorganized territory, and areas with none defined. */
const STATISTICAL = new Set(['22', '23', '46', '00'])

/* ------------------------------------------------------------------ build */

const report = { generatedAt: new Date().toISOString(), vintage: VINTAGE, levels: {}, checks: {}, problems: [] }
const problem = (message) => report.problems.push(message)

const states = await load(SOURCES.state)
const counties = await load(SOURCES.county)
const cousubs = await load(SOURCES.cousub)
console.log(`[usa] ${states.length} states, ${counties.length} counties, ${cousubs.length} county subdivisions`)

const stateByFips = new Map(states.map((f) => [f.properties.STATEFP, f.properties]))
const countyByGeoid = new Map(counties.map((f) => [f.properties.GEOID, f.properties]))

const km2 = (m2) => Math.round((m2 ?? 0) / 1e4) / 100

const parentOf = (statefp) => {
  const s = stateByFips.get(statefp)
  return { id: `state-${statefp}`, name: s.NAME, iso2: null, kind: stateKind(statefp), code: s.STUSPS }
}

const placeOf = (statefp) => {
  const d = divisionOf[statefp]
  if (!d) problem(`state ${statefp} has no Census division`)
  return { region: d?.region ?? 'United States', subregion: d?.division ?? 'United States' }
}

const censusGroups = (statefp) => {
  const d = divisionOf[statefp]
  if (!d) return []
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return [
    { scheme: d.region === 'Territories' ? 'Territories' : 'Census division', id: `usa-division-${slug(d.division)}`, name: d.division },
    { scheme: 'Census region', id: `usa-region-${slug(d.region)}`, name: d.region },
  ]
}

function source(sourceKey, props, geoid) {
  const s = SOURCES[sourceKey]
  return {
    dataset: `U.S. Census Bureau, ${s.name}, ${s.title}, ${VINTAGE} (${s.scale})`,
    ids: [geoid],
    geoid,
    vintage: VINTAGE,
    codes: Object.fromEntries(
      ['GEOIDFQ', 'STATEFP', 'COUNTYFP', 'COUSUBFP', 'STATENS', 'COUNTYNS', 'COUSUBNS', 'STUSPS', 'LSAD']
        .filter((k) => props[k] != null && props[k] !== '')
        .map((k) => [k, String(props[k])]),
    ),
    landKm2: km2(props.ALAND),
    waterKm2: km2(props.AWATER),
    iso31662: null,
    hasc: null,
    wikidata: null,
  }
}

/** Entities of one level: `{ id, polygons, core, details }`. */
const levels = {}

levels.states = states.map((f) => {
  const p = f.properties
  const id = `state-${p.STATEFP}`
  return {
    id,
    polygons: uniquePolygons(polygonsOf(f.geometry)),
    core: {
      name: p.NAME,
      officialName: TERRITORY_NAMES[p.STATEFP] ?? p.NAME,
      kind: stateKind(p.STATEFP),
      code: p.STUSPS,
      parent: { id: 'USA', name: 'United States', iso2: 'US', kind: 'Country', code: 'US' },
      ...placeOf(p.STATEFP),
      groups: censusGroups(p.STATEFP),
    },
    details: { source: { ...source('state', p, p.GEOID), iso31662: `US-${p.STUSPS}` } },
  }
})

levels.counties = counties.map((f) => {
  const p = f.properties
  return {
    id: `county-${p.GEOID}`,
    polygons: uniquePolygons(polygonsOf(f.geometry)),
    core: {
      name: p.NAMELSAD,
      officialName: p.NAMELSAD,
      kind: countyKind(p),
      code: p.GEOID,
      parent: parentOf(p.STATEFP),
      ...placeOf(p.STATEFP),
      groups: censusGroups(p.STATEFP),
    },
    details: { source: source('county', p, p.GEOID) },
  }
})

{
  const units = []
  const statistical = new Map() // county GEOID -> features
  const perCounty = new Map()
  for (const f of cousubs) {
    const p = f.properties
    const county = `${p.STATEFP}${p.COUNTYFP}`
    perCounty.set(county, (perCounty.get(county) ?? 0) + 1)
    if (STATISTICAL.has(p.LSAD)) {
      const list = statistical.get(county) ?? []
      list.push(f)
      statistical.set(county, list)
      continue
    }
    const c = countyByGeoid.get(county)
    units.push({
      id: `cousub-${p.GEOID}`,
      polygons: uniquePolygons(polygonsOf(f.geometry)),
      core: {
        name: p.NAMELSAD,
        officialName: p.NAMELSAD,
        kind: COUSUB_LSAD[p.LSAD] ?? 'County subdivision',
        code: p.GEOID,
        parent: parentOf(p.STATEFP),
        ...placeOf(p.STATEFP),
        groups: [
          ...(c ? [{ scheme: countyKind(c).replace(/ \(.*\)$/, ''), id: `county-${county}`, name: c.NAMELSAD }] : []),
          ...censusGroups(p.STATEFP),
        ],
      },
      details: { source: source('cousub', p, p.GEOID) },
    })
  }
  /*
   * Where a county's subdivisions are statistical, the county is what is administered, and it
   * is drawn — from the subdivision file's own lines, so it meets its neighbours exactly. A
   * county wholly statistical is the county, under the county's own id; the statistical part
   * of an otherwise organised county is its unorganized territory.
   */
  for (const [county, features] of statistical) {
    const c = countyByGeoid.get(county)
    if (!c) {
      problem(`county subdivisions name county ${county}, which the county file does not have`)
      continue
    }
    const whole = features.length === perCounty.get(county)
    const polygons = dissolve(features.map((f) => uniquePolygons(polygonsOf(f.geometry))))
    const types = [...new Set(features.map((f) => f.properties.LSAD))]
    units.push({
      id: whole ? `county-${county}` : `cousub-${county}-rest`,
      polygons,
      core: {
        name: whole ? c.NAMELSAD : `Unorganized territory, ${c.NAMELSAD}`,
        officialName: whole ? c.NAMELSAD : `${c.NAMELSAD} (area outside county subdivisions)`,
        kind: whole ? countyKind(c) : 'Unorganized territory',
        code: whole ? county : `${county}-rest`,
        parent: parentOf(c.STATEFP),
        ...placeOf(c.STATEFP),
        groups: [...(whole ? [] : [{ scheme: countyKind(c).replace(/ \(.*\)$/, ''), id: `county-${county}`, name: c.NAMELSAD }]), ...censusGroups(c.STATEFP)],
      },
      details: {
        source: {
          ...source('county', c, county),
          dataset: `U.S. Census Bureau, ${SOURCES.cousub.name}, ${SOURCES.cousub.title}, ${VINTAGE} (${SOURCES.cousub.scale}): the county's statistical subdivisions (${types.map((t) => ({ '22': 'census county divisions', '23': 'census subareas', '46': 'unorganized territory', '00': 'undefined' })[t]).join(', ')}), joined`,
          ids: features.map((f) => f.properties.GEOID),
          ...(whole ? {} : { landKm2: km2(features.reduce((s, f) => s + f.properties.ALAND, 0)), waterKm2: km2(features.reduce((s, f) => s + f.properties.AWATER, 0)) }),
        },
      },
    })
  }
  levels.subdivisions = units
}

const LEVEL_INFO = {
  states: { name: 'States, the District of Columbia and territories' },
  counties: { name: 'Counties and county-equivalents' },
  subdivisions: { name: 'County subdivisions (legal), counties where only statistical' },
}

/* ------------------------------------------------------------ validation */

// Ids unique within each level; every county's state present; the special cases.
for (const [level, units] of Object.entries(levels)) {
  const seen = new Set()
  for (const u of units) {
    if (seen.has(u.id)) problem(`${level}: duplicate id ${u.id}`)
    seen.add(u.id)
    if (u.polygons.length === 0) problem(`${level}: ${u.id} has no geometry`)
  }
}
const byState = (units) => units.reduce((m, u) => ((m[u.core.parent.code] = (m[u.core.parent.code] ?? 0) + 1), m), {})
report.checks.countiesPerState = byState(levels.counties)
report.checks.subdivisionsPerState = byState(levels.subdivisions)
const expect = { CA: 58, TX: 254, AK: 30, LA: 64, VA: 133, MD: 24, DE: 3, HI: 5, PR: 78, DC: 1 }
for (const [s, n] of Object.entries(expect)) {
  if (report.checks.countiesPerState[s] !== n) problem(`counties: ${s} has ${report.checks.countiesPerState[s]}, expected ${n}`)
}
report.checks.kinds = {}
for (const [level, units] of Object.entries(levels)) {
  report.checks.kinds[level] = units.reduce((m, u) => ((m[u.core.kind] = (m[u.core.kind] ?? 0) + 1), m), {})
}

// Area: each state's counties, and each county's subdivisions, add up to it.
{
  const stateArea = new Map(levels.states.map((u) => [u.core.code, areaKm2(u.polygons)]))
  const sum = (units, key) => units.reduce((m, u) => m.set(key(u), (m.get(key(u)) ?? 0) + areaKm2(u.polygons)), new Map())
  const countySum = sum(levels.counties, (u) => u.core.parent.code)
  const subSum = sum(levels.subdivisions, (u) => u.core.parent.code)
  const off = []
  for (const [s, a] of stateArea) {
    const c = countySum.get(s) ?? 0
    const d = subSum.get(s) ?? 0
    if (Math.abs(c - a) / a > 0.01 || Math.abs(d - c) / c > 0.01) off.push({ state: s, stateKm2: Math.round(a), countiesKm2: Math.round(c), subdivisionsKm2: Math.round(d) })
  }
  report.checks.areaMismatchOver1Percent = off
  if (off.length) problem(`area: ${off.length} states whose levels differ by more than 1% — see checks.areaMismatchOver1Percent`)
}

/* ------------------------------------------------------------------ water */

/*
 * Every USGS waterbody, indexed, so an edge the subdivision file leaves unshared inside the
 * land can be told apart as a shore — Lake Springfield, the Occoquan Reservoir, the
 * Monongahela at Monessen are left out of the county subdivisions and kept in the counties —
 * from a gap between two neighbours, which would be a fault.
 */
const waterbodies = await load(SOURCES.waterbodies)
const streams = await load(SOURCES.streams)

/**
 * Whether a point is water by USGS: inside a waterbody, or within half a kilometre of a river
 * of Strahler order 3 and up (the Monongahela is a line in the stream layer, not a polygon).
 */
const isWater = (() => {
  const CELL = 0.05
  const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
  const bodies = waterbodies.map((f) => ({ ...indexed(polygonsOf(f.geometry).map(oriented)) }))
  const lines = new Map()
  for (const f of streams) {
    if (!(f.properties.Strahler >= 3)) continue
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const line of parts)
      for (let i = 1; i < line.length; i++) {
        const k = key(line[i][0], line[i][1])
        const list = lines.get(k)
        if (list) list.push([line[i - 1], line[i]])
        else lines.set(k, [[line[i - 1], line[i]]])
      }
  }
  return (p) => {
    if (bodies.some((b) => contains(b, p))) return true
    const cx = Math.floor(p[0] / CELL)
    const cy = Math.floor(p[1] / CELL)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [a, b] of lines.get(`${cx + dx},${cy + dy}`) ?? []) {
          const vx = b[0] - a[0]
          const vy = b[1] - a[1]
          const l2 = vx * vx + vy * vy
          const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0
          if (km(p[0], p[1], a[0] + t * vx, a[1] + t * vy) <= 0.5) return true
        }
    return false
  }
})()

/** Douglas–Peucker, with a tolerance under a pixel at any zoom the editor offers. */
const SIMPLIFY = 0.0004
function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let max = -1
    let at = -1
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const vx = bx - ax
    const vy = by - ay
    const l2 = vx * vx + vy * vy
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0
      const d = Math.hypot(ax + t * vx - px, ay + t * vy - py)
      if (d > max) {
        max = d
        at = i
      }
    }
    if (max > tolerance) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return points.filter((_, i) => keep[i])
}
// A lake whose outer ring collapses goes whole: its islands left alone would be drawn as lakes.
const simplifyPolygons = (polygons) =>
  polygons
    .map((polygon) => polygon.map((ring) => simplifyLine(ring, SIMPLIFY)))
    .filter((polygon) => polygon[0]?.length >= 4)
    .map((polygon) => [polygon[0], ...polygon.slice(1).filter((ring) => ring.length >= 4)])

/* ------------------------------------------------------------- sliver gaps */

/**
 * Closes any sliver the 1:500,000 generalisation leaves between neighbouring units.
 *
 * A strip no unit covers would be drawn as a hairline of background, with an edge drawn as
 * coast inside the land. Merging a state's units finds such strips exactly, as holes; a hole
 * that no unit covers and that USGS does not show as water is one, and it joins the unit it
 * shares the most edge with. Every coordinate involved is the source's own, so the join is
 * exact. The report counts what was filled, and what the merge reported but a unit covers.
 */
function fillSlivers(units) {
  const stats = { filled: 0, filledKm2: 0, water: 0, large: 0, covered: 0 }
  const byState = new Map()
  for (const u of units) {
    const list = byState.get(u.core.parent.id) ?? []
    list.push(u)
    byState.set(u.core.parent.id, list)
  }
  const key = (p) => `${p[0]},${p[1]}`
  for (const list of byState.values()) {
    const merged = dissolve(list.map((u) => u.polygons))
    const holes = merged.flatMap((polygon) => polygon.slice(1))
    if (holes.length === 0) continue
    const cover = list.map((u) => indexed(u.polygons.map(oriented)))
    const owners = new Map()
    list.forEach((u, index) => {
      for (const polygon of u.polygons)
        for (const ring of polygon)
          for (const p of ring) {
            const set = owners.get(key(p))
            if (set) set.add(index)
            else owners.set(key(p), new Set([index]))
          }
    })
    for (const hole of holes) {
      const area = areaKm2([[hole]])
      if (area > 25) {
        stats.large++
        continue
      }
      const point = interiorPoint([[hole]])
      /*
       * A hole a unit already covers is not a strip. The merge reports one where a unit is two
       * polygons touching at a point and its neighbour's hole around them is one ring pinched
       * there — Harrold, South Dakota; Watford City, North Dakota — and joining it would give
       * that unit its own ground a second time.
       */
      if (point && cover.some((entry) => contains(entry, point))) {
        stats.covered++
        continue
      }
      if (point && isWater(point)) {
        stats.water++
        continue
      }
      const score = new Map()
      for (let i = 1; i < hole.length; i++) {
        const a = owners.get(key(hole[i - 1]))
        const b = owners.get(key(hole[i]))
        if (!a || !b) continue
        const length = km(hole[i - 1][0], hole[i - 1][1], hole[i][0], hole[i][1])
        for (const index of a) if (b.has(index)) score.set(index, (score.get(index) ?? 0) + length)
      }
      const best = [...score].sort((x, y) => y[1] - x[1])[0]
      if (!best) continue
      const unit = list[best[0]]
      unit.polygons = dissolve([unit.polygons, [[hole]]])
      stats.filled++
      stats.filledKm2 += area
    }
  }
  stats.filledKm2 = Number(stats.filledKm2.toFixed(3))
  return stats
}
/**
 * Rings that pass through a vertex twice, split there into rings that do not.
 *
 * Joining a county's statistical pieces returns a hole around an enclave that is two polygons
 * touching at a point — Harrold, South Dakota; Watford City, North Dakota — as one ring
 * pinched at that point, while the enclave has two. TopoJSON pairs a pinched ring with a
 * pinched ring and a simple ring with a simple ring, but not the one with the two, so both
 * sides of the enclave's border would be drawn as coast. Split, every ring is simple and the
 * border is shared. A pinched outer ring becomes two polygons, each keeping the holes inside it.
 */
function splitRing(ring) {
  const out = []
  let stack = []
  const seen = new Map()
  for (const p of ring.slice(0, -1)) {
    const k = `${p[0]},${p[1]}`
    if (seen.has(k)) {
      const loop = stack.slice(seen.get(k))
      stack = stack.slice(0, seen.get(k))
      for (const q of loop) seen.delete(`${q[0]},${q[1]}`)
      if (loop.length >= 3) out.push([...loop, loop[0]])
    }
    seen.set(k, stack.length)
    stack.push(p)
  }
  if (stack.length >= 3) out.push([...stack, stack[0]])
  return out
}

function insideRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function unpinched(polygons) {
  let split = 0
  const out = []
  for (const [outer, ...holes] of polygons) {
    const outers = splitRing(outer)
    const inner = holes.flatMap((hole) => {
      const parts = splitRing(hole)
      split += parts.length - 1
      return parts
    })
    split += outers.length - 1
    if (outers.length === 1) {
      out.push([outers[0], ...inner])
      continue
    }
    const pieces = outers.map((ring) => [ring])
    for (const hole of inner) {
      const point = interiorPoint([[hole]])
      const home = pieces.find(([ring]) => point && insideRing(point, ring)) ?? pieces[0]
      home.push(hole)
    }
    out.push(...pieces)
  }
  return { polygons: out, split }
}

for (const level of ['counties', 'subdivisions']) {
  report.levels[level] = { slivers: fillSlivers(levels[level]) }
  let pinched = 0
  for (const u of levels[level]) {
    const { polygons, split } = unpinched(u.polygons)
    if (split) {
      u.polygons = polygons
      pinched += split
    }
  }
  report.levels[level].pinchedRingsSplit = pinched
  console.log(`[usa] ${level}: slivers ${JSON.stringify(report.levels[level].slivers)}`)
}

/* ---------------------------------------------------------------- topology */

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const written = {}
const write = (name, value) => {
  const text = JSON.stringify(value)
  writeFileSync(resolve(outDir, name), text)
  written[name] = `${(text.length / 1e6).toFixed(2)} MB`
}

/** Outline edges for the "a unit's edge drawn as coast inside the land" check. */
const stateOutline = (() => {
  const CELL = 0.05
  const cells = new Map()
  for (const u of levels.states)
    for (const polygon of u.polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
          const b = ring[i]
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
          for (let s = 0; s <= steps; s++) {
            const key = `${Math.floor((a[0] + ((b[0] - a[0]) * s) / steps) / CELL)},${Math.floor((a[1] + ((b[1] - a[1]) * s) / steps) / CELL)}`
            const list = cells.get(key)
            if (list) list.push([a, b])
            else cells.set(key, [[a, b]])
          }
        }
  return (p) => {
    let best = Infinity
    const cx = Math.floor(p[0] / CELL)
    const cy = Math.floor(p[1] / CELL)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [a, b] of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const vx = b[0] - a[0]
          const vy = b[1] - a[1]
          const l2 = vx * vx + vy * vy
          const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0
          best = Math.min(best, km(p[0], p[1], a[0] + t * vx, a[1] + t * vy))
        }
    return best
  }
})()

for (const [level, units] of Object.entries(levels)) {
  const topology = topojson.topology(
    { units: { type: 'FeatureCollection', features: units.map((u) => ({ type: 'Feature', id: u.id, geometry: { type: 'MultiPolygon', coordinates: u.polygons } })) } },
    QUANTIZATION,
  )

  // An arc one unit alone uses is coast; inside the land, it is a gap between neighbours.
  const uses = new Map()
  for (const g of topology.objects.units.geometries) {
    const walk = (a) => (typeof a === 'number' ? uses.set(a < 0 ? ~a : a, (uses.get(a < 0 ? ~a : a) ?? 0) + 1) : a.forEach(walk))
    walk(g.arcs ?? [])
  }
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const inland = { shore: { arcs: 0, km: 0 }, gap: { arcs: 0, km: 0, samples: [] } }
  const unitIndex = level === 'states' ? [] : units.map((u) => indexed(u.polygons.map(oriented)))
  const covered = (p) => unitIndex.some((entry) => contains(entry, p))
  if (level !== 'states') {
    for (const [a, n] of uses) {
      if (n !== 1) continue
      let x = 0
      let y = 0
      const points = topology.arcs[a].map(([dx, dy]) => [tx + (x += dx) * sx, ty + (y += dy) * sy])
      const middle = points[Math.floor(points.length / 2)]
      if (stateOutline(middle) <= 1) continue
      let length = 0
      for (let i = 1; i < points.length; i++) length += km(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
      // Two points quantised to one: an arc of no length, which draws nothing.
      if (length === 0) continue
      /*
       * The shore of inland water the source leaves out of its units, or a gap between
       * neighbours: step a few metres off the edge to the side no unit covers, and ask USGS
       * whether that is water.
       */
      const i = Math.max(1, Math.floor(points.length / 2))
      const [p0, p1] = [points[i - 1], points[i]]
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1
      const off = [(-(p1[1] - p0[1]) / len) * 0.0005, ((p1[0] - p0[0]) / len) * 0.0005]
      const sides = [
        [mid[0] + off[0], mid[1] + off[1]],
        [mid[0] - off[0], mid[1] - off[1]],
      ]
      const open = sides.find((p) => !covered(p)) ?? mid
      const kind = isWater(open) ? inland.shore : inland.gap
      kind.arcs++
      kind.km += length
      if (kind === inland.gap && kind.samples.length < 8) kind.samples.push(middle.map((v) => Number(v.toFixed(4))))
    }
  }

  /*
   * The entity table, compact: what every unit shares is said once (`defaults`), a state's
   * name, codes, region and Census groups once per state (`parents`), and a county a
   * subdivision belongs to once per county (`groups`) — the loader (`countryMeta.ts`)
   * expands them. The codes and source are a separate file, split by state at the level
   * where there are tens of thousands of them, so the inspector fetches one state's worth.
   */
  const parents = {}
  const groupTable = {}
  const entities = {}
  const details = new Map()
  for (const u of units) {
    const point = interiorPoint(u.polygons) ?? [0, 0]
    const { parent, groups, officialName, region, subregion, ...rest } = u.core
    if (!parents[parent.id]) {
      parents[parent.id] =
        level === 'states' ? parent : { ...parent, region, subregion, groups: censusGroups(parent.id.slice('state-'.length)) }
    }
    const entry = { ...rest, parent: parent.id, lat: Number(point[1].toFixed(4)), lng: Number(point[0].toFixed(4)) }
    if (officialName && officialName !== rest.name) entry.officialName = officialName
    if (level === 'states') Object.assign(entry, { region, subregion, groups })
    else {
      const own = groups.filter((g) => !g.id.startsWith('usa-'))
      if (own.length) entry.groups = own.map((g) => ((groupTable[g.id] = g), g.id))
    }
    entities[u.id] = entry
    const shard = level === 'subdivisions' ? parent.id : null
    const list = details.get(shard) ?? {}
    list[u.id] = u.details
    details.set(shard, list)
  }

  write(`${level}.json`, topology)
  write(`${level}-meta.json`, {
    generatedAt: report.generatedAt,
    numericToId: {},
    nameToId: {},
    defaults: { iso2: null, numeric: null, independent: false, level: { id: level, name: LEVEL_INFO[level].name } },
    parents,
    groups: groupTable,
    entities,
  })
  for (const [shard, list] of details) {
    if (shard) {
      mkdirSync(resolve(outDir, `${level}-details`), { recursive: true })
      write(`${level}-details/${shard}.json`, { generatedAt: report.generatedAt, entities: list })
    } else {
      write(`${level}-details.json`, { generatedAt: report.generatedAt, entities: list })
    }
  }
  const points = topology.arcs.reduce((s, arc) => s + arc.length, 0)
  report.levels[level] = {
    ...report.levels[level],
    units: units.length,
    points,
    inlandShores: { arcs: inland.shore.arcs, km: Number(inland.shore.km.toFixed(1)) },
    inlandGaps: { arcs: inland.gap.arcs, km: Number(inland.gap.km.toFixed(1)), samples: inland.gap.samples },
  }
  if (inland.gap.arcs) problem(`${level}: ${inland.gap.arcs} unit edges (${inland.gap.km.toFixed(1)} km) are shared by no neighbour inside the land, away from any water`)
  console.log(`[usa] ${level}: ${units.length} units, ${points.toLocaleString()} points, ${written[`${level}.json`]}`)
}

/* ------------------------------------------------------------------ water */

const round = (n) => Number(n.toFixed(4))
const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords))

{
  /*
   * Lakes, reservoirs and the widest rivers from USGS, 3 square miles and up, where the
   * county layer draws land. Water the county geometry already leaves out — the Great Lakes,
   * the bays — is not drawn a second time, over a shoreline of its own.
   */
  const land = levels.counties.map((u) => ({ ...indexed(u.polygons.map(oriented)) }))
  const onLand = (point) => land.some((entry) => contains(entry, point))
  const KEEP = new Set(['Lake', 'Reservoir', 'Stream', 'Lake Intermittent'])
  const lakes = []
  let skipped = 0
  for (const f of waterbodies) {
    const p = f.properties
    if (!KEEP.has(p.Feature) || !(p.Area_sq_mi >= 3)) continue
    const point = interiorPoint(polygonsOf(f.geometry))
    if (!point || !onLand(point)) {
      skipped++
      continue
    }
    const polygons = simplifyPolygons(polygonsOf(f.geometry))
    if (polygons.length === 0) continue
    lakes.push({
      type: 'Feature',
      properties: { name: p.Name ?? null, scalerank: p.Area_sq_mi >= 500 ? 0 : p.Area_sq_mi >= 50 ? 2 : p.Area_sq_mi >= 10 ? 4 : 6, kind: p.Feature },
      geometry: { type: 'MultiPolygon', coordinates: roundCoords(polygons) },
    })
  }
  lakes.sort((a, b) => a.properties.scalerank - b.properties.scalerank)
  write('lakes.geojson', { type: 'FeatureCollection', features: lakes })
  report.water = { lakes: lakes.length, notOverCountyLand: skipped }

  const rivers = streams
    .filter((f) => (f.properties.Feature === 'Stream' || f.properties.Feature === 'Artificial Path') && f.properties.Strahler >= 6)
    .map((f) => ({
      type: 'Feature',
      properties: { name: f.properties.Name ?? null, scalerank: Math.max(0, 12 - f.properties.Strahler) },
      geometry:
        f.geometry.type === 'LineString'
          ? { type: 'LineString', coordinates: roundCoords(simplifyLine(f.geometry.coordinates, SIMPLIFY)) }
          : { type: 'MultiLineString', coordinates: roundCoords(f.geometry.coordinates.map((line) => simplifyLine(line, SIMPLIFY))) },
    }))
  write('rivers.geojson', { type: 'FeatureCollection', features: rivers })
  report.water.riverSegments = rivers.length
  console.log(`[usa] water: ${lakes.length} lakes (${skipped} already water in the county layer), ${rivers.length} river segments`)
}

/* ---------------------------------------------------------------- credits */

write('sources.json', {
  generatedAt: report.generatedAt,
  licence: 'Public domain: works of the U.S. Government are not subject to copyright (17 U.S.C. §105).',
  sources: Object.values(SOURCES).map((s) => ({ name: s.name, title: s.title, scale: s.scale, url: s.url, agency: s.name.startsWith('cb_') ? 'U.S. Census Bureau' : 'U.S. Geological Survey' })),
})

report.outputs = written
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 1))
console.log(`[usa] wrote ${Object.entries(written).map(([k, v]) => `${k} ${v}`).join(', ')}`)
if (report.problems.length) console.log(`[usa] ${report.problems.length} problems:\n  ${report.problems.join('\n  ')}`)
