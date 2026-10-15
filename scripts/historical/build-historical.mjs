/**
 * Builds the historical world maps: 1914, 1938 and 1945 from historical-basemaps, and 1990 from
 * the modern map.
 *
 * A maintenance script, NOT part of the build: it writes `data/historical/`, which is committed;
 * `prepare-data.mjs` only copies it. Run after `npm run prepare-data` (it reads the modern map's
 * entity table from `public/geo/`):
 *
 *   node scripts/historical/build-historical.mjs
 *   node scripts/historical/build-historical.mjs --refresh     (download the sources again)
 *
 * **Source** for 1914, 1938 and 1945: Andrés Ourednik's historical-basemaps
 * (github.com/aourednik/historical-basemaps), GNU GPL v3 — so the maps derived from it here are
 * GPL v3 as well; see `data/historical/LICENSE`. Its borders are what the maps show; its
 * coastlines are not. They are coarse — about 40,000 points for the whole world — so the land is
 * the modern World map's own (Natural Earth, public domain, at 25m), cut along the historical
 * borders:
 *
 *   1. Every modern country is cut by the historical units that overlap it, keeping the modern
 *      outline: the coast, and the modern border where a historical one runs along it.
 *   2. What the historical outlines leave of a modern country — a coastal strip, an island the
 *      coarse source does not draw — joins the unit it shares the most edge with in that
 *      country, or the nearest one when it is an island. A modern country no unit reaches keeps
 *      its modern name (Antarctica).
 *   3. The cut points are put on both sides of every border (`admin/node.mjs`), so a border two
 *      units share is one line, and each unit's pieces are joined exactly (`dissolve`).
 *
 * **1990** is the modern map's own countries, joined where they were one state at the end of
 * 1990 — the Soviet Union, Yugoslavia, Czechoslovakia; Eritrea in Ethiopia, South Sudan in Sudan,
 * Somaliland in Somalia — and named as they were. Germany and Yemen had unified by then. A
 * country whose flag has changed since keeps no flag rather than show today's.
 *
 * The historical units carry no flags yet (a modern flag on a 1914 empire would be wrong), and no
 * ISO codes: their ids are lowercase slugs, which can never collide with the modern map's.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as topojsonServer from 'topojson-server'
import * as topojsonClient from 'topojson-client'
import * as clipper from '../admin/clip.mjs'
import { node } from '../admin/node.mjs'
import {
  areaKm2,
  boundaryIndex,
  boundsOf,
  boxesMeet,
  despiked,
  dissolve,
  interiorPoint,
  km,
  nearestPart,
  oriented,
  polygonAreaKm2,
  polygonsOf,
  ringLengthKm,
} from '../admin/geometry.mjs'
import { unpinched } from '../europe/unpinch.mjs'
import { CURATION, ISLANDS } from './curation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cacheDir = resolve(root, '.cache/hist-src')
const outDir = resolve(root, 'data/historical')
const REFRESH = process.argv.includes('--refresh')
const SOURCE = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/'
const YEARS = [1914, 1938, 1945]
/** Read for `carve` outlines only: 1930 draws interwar East Prussia and Danzig, 1938 does not. */
const SOURCE_YEARS = [1914, 1930, 1938, 1945]
/** The modern map's grid: ~40 m, the same as its 25m topology. */
const QUANTIZATION = 1e6

/** Below this a cut is nothing (well under a hectare). */
const SCRAP_KM2 = 0.001
/** A thin scrap of a unit away from its body is a seam between the sources, not its land. */
const SLIVER_WIDTH_KM = 0.5
const SLIVER_MAX_AREA_KM2 = 200
/**
 * Where a border has not moved since, the source draws it a few kilometres off the modern one:
 * every modern country comes out with a strip of its neighbour along it — 10,700 km² of Canada
 * inside the United States, 6–9 km wide. Real changes are not strips: Zaolzie, Memel and Istria
 * are 10–12 km wide on this measure (twice the area over the perimeter), Alsace far more. So a
 * piece of a unit narrower than this, lying along another unit of the same modern country for
 * at least this share of its outline, is the seam, and goes to its neighbour. An island is never
 * a strip: the Dodecanese stay Italian.
 */
const STRIP_WIDTH_KM = 8
const STRIP_SHARED = 0.25

const log = (...args) => console.log('[historical]', ...args)

/* ---------------------------------------------------------------- inputs */

const modernTopology = JSON.parse(readFileSync(resolve(root, 'data/natural-earth/countries-25m.json'), 'utf8'))
const metaPath = resolve(root, 'public/geo/country-meta.json')
if (!existsSync(metaPath)) throw new Error('public/geo/country-meta.json is missing: run `npm run prepare-data` first')
const modernMeta = JSON.parse(readFileSync(metaPath, 'utf8')).entities
const modernFeatures = topojsonClient.feature(modernTopology, modernTopology.objects.countries).features

/**
 * Natural Earth's admin-1 provinces (public domain), for the few outlines no historical source
 * draws — the Kars provinces, Russian from 1878 to 1918; the Hatay State of 1938.
 */
const ADMIN1 = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
let admin1 = null
async function admin1Outline(codes) {
  if (!admin1) {
    const file = resolve(root, '.cache/ne/ne_10m_admin_1_states_provinces.geojson')
    if (REFRESH || !existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true })
      const response = await fetch(ADMIN1)
      if (!response.ok) throw new Error(`admin-1: ${response.status}`)
      writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    }
    admin1 = JSON.parse(readFileSync(file, 'utf8')).features
  }
  const polygons = admin1.filter((f) => codes.includes(f.properties.iso_3166_2)).flatMap((f) => polygonsOf(f.geometry)).map(oriented)
  if (polygons.length === 0) throw new Error(`admin-1: none of ${codes.join(', ')}`)
  return polygons
}

async function source(year) {
  const file = resolve(cacheDir, `world_${year}.geojson`)
  if (REFRESH || !existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true })
    const response = await fetch(`${SOURCE}world_${year}.geojson`)
    if (!response.ok) throw new Error(`world_${year}.geojson: ${response.status}`)
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/* ------------------------------------------------------------- regions */

/*
 * Which region presets a modern country is in — the rules of `src/geo/regions.ts`, repeated here
 * because this script cannot import TypeScript. A historical unit is in every region where a
 * real part of it lies, so the Ottoman Empire of 1914 is on a map of Europe as well as of Asia.
 */
const EUROPE_EXTRA = new Set(['TUR', 'CYP', 'XNC', 'GEO', 'ARM', 'AZE'])
const AMERICAS_NORTH = new Set(['North America', 'Central America', 'Caribbean'])
function presetsOf(m) {
  const out = []
  if (!m) return out
  if (m.region === 'Europe' || EUROPE_EXTRA.has(m.id)) out.push('europe')
  if (m.region === 'Asia') out.push('asia')
  if (m.region === 'Africa') out.push('africa')
  if (m.region === 'Americas' && AMERICAS_NORTH.has(m.subregion)) out.push('north-america')
  if (m.region === 'Americas' && m.subregion === 'South America') out.push('south-america')
  if (m.region === 'Oceania') out.push('oceania')
  return out
}
/** A part counts towards a region from this size, or this share of the unit. */
const REGION_KM2 = 20000
const REGION_SHARE = 0.1

/* ------------------------------------------------------------- cutting */

const safely = (run) => {
  try {
    return run()
  } catch (error) {
    return { error }
  }
}

const slug = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * One modern country cut by the historical units over it: one piece per unit, the modern outline
 * kept, every leftover handed to the unit beside it. The logic of `admin/geometry.mjs`'s `split`,
 * the other way round — there a fine unit sits in one base; here a historical unit spans many.
 */
function cutBase(base, units, report, beats) {
  const bounds = boundsOf(base.polygons)
  const byUnit = new Map()
  for (const unit of units) {
    if (!boxesMeet(bounds, unit.bounds)) continue
    const cut = safely(() => clipper.intersection(base.polygons, unit.polygons))
    if (cut.error) {
      report.failures.push({ base: base.id, unit: unit.name, error: String(cut.error.message ?? cut.error) })
      continue
    }
    if (areaKm2(cut) < SCRAP_KM2) continue
    const known = byUnit.get(unit.id)
    if (known) known.polygons.push(...cut)
    else byUnit.set(unit.id, { unit, polygons: cut })
  }
  const parts = [...byUnit.values()].map((p) => ({ ...p, area: areaKm2(p.polygons) })).sort((a, b) => b.area - a.area)
  if (parts.length === 0) {
    report.unclaimed.push(base.id)
    return [{ unit: null, baseId: base.id, polygons: base.polygons }]
  }
  // One unit over the whole country: its outline is the modern one, exactly.
  if (parts.length === 1) return [{ unit: parts[0].unit, baseId: base.id, polygons: base.polygons }]

  // A unit's own pieces as one, then overlaps between units resolved — the smaller gives way,
  // unless the curation says the other keeps it.
  for (const part of parts) {
    const joined = safely(() => clipper.union(part.polygons))
    if (!joined.error) part.polygons = joined
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (!boxesMeet(boundsOf(parts[i].polygons), boundsOf(parts[j].polygons))) continue
      const overlap = safely(() => clipper.intersection(parts[i].polygons, parts[j].polygons))
      if (overlap.error || areaKm2(overlap) < SCRAP_KM2) continue
      report.overlapsKm2 += areaKm2(overlap)
      const [keep, give] = beats(parts[j].unit.id, parts[i].unit.id) ? [parts[j], parts[i]] : [parts[i], parts[j]]
      if (areaKm2(overlap) > 1000) report.overlaps.push({ base: base.id, kept: keep.unit.name, gave: give.unit.name, km2: Math.round(areaKm2(overlap)) })
      const rest = safely(() => clipper.difference(give.polygons, keep.polygons))
      if (!rest.error) give.polygons = rest
    }
  }

  // Thin scraps of a unit away from its body are seams between the two sources; so are strips
  // of a neighbour along the country's main unit.
  const touching = boundaryIndex(parts)
  const sharedShare = (polygon, self) => {
    let shared = 0
    let total = 0
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]
        const b = ring[i]
        const length = km(a[0], a[1], b[0], b[1])
        total += length
        for (const owner of touching([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) {
          if (owner === self) continue
          shared += length
          break
        }
      }
    }
    return total > 0 ? shared / total : 0
  }
  const loose = []
  parts.forEach((part, self) => {
    const ranked = part.polygons
      .map((p) => ({ p, area: polygonAreaKm2(p), perimeter: ringLengthKm(p[0]) }))
      .sort((a, b) => b.area - a.area)
    part.polygons = []
    ranked.forEach(({ p, area, perimeter }, k) => {
      const width = perimeter > 0 ? (2 * area) / perimeter : 0
      if (self > 0 && width < STRIP_WIDTH_KM && sharedShare(p, self) >= STRIP_SHARED) {
        report.stripsKm2 += area
        loose.push(p)
        return
      }
      const seam = area < SCRAP_KM2 || (width < SLIVER_WIDTH_KM && area < SLIVER_MAX_AREA_KM2)
      if (k === 0 || !seam) part.polygons.push(p)
      else loose.push(p)
    })
  })
  const residual = safely(() => clipper.difference(base.polygons, ...parts.map((p) => p.polygons)))
  if (residual.error) report.failures.push({ base: base.id, stage: 'residual', error: String(residual.error.message ?? residual.error) })
  else loose.push(...residual)

  // Each leftover joins the unit it shares the most edge with, or the nearest when it is an island.
  const running = boundaryIndex(parts)
  const extra = parts.map(() => [])
  for (const polygon of loose) {
    const area = polygonAreaKm2(polygon)
    if (area <= 0) continue
    report.reconciledKm2 += area
    const score = new Array(parts.length).fill(0)
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]
        const b = ring[i]
        const owners = running([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
        if (owners.size === 0) continue
        const length = km(a[0], a[1], b[0], b[1])
        for (const index of owners) score[index] += length
      }
    }
    let pick = score.indexOf(Math.max(...score))
    if (!(score[pick] > 0)) pick = nearestPart(parts, polygon)
    extra[pick].push(polygon)
  }
  return parts.map((part, index) => {
    let polygons = part.polygons
    if (extra[index].length > 0) {
      const joined = safely(() => clipper.union(polygons, ...extra[index].map((p) => [p])))
      polygons = joined.error ? [...polygons, ...extra[index]] : joined
    }
    return { unit: part.unit, baseId: base.id, polygons: despiked(closeRings(polygons)).map(oriented) }
  })
}

const closeRings = (polygons) =>
  polygons.map((polygon) =>
    polygon.map((ring) => {
      const first = ring[0]
      const last = ring[ring.length - 1]
      return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
    }),
  )

/** A source unit's outline: every feature filed under that name. */
const outlineOf = (collection, name) =>
  collection.features.filter((f) => String(f.properties?.NAME ?? '').trim() === name).flatMap((f) => polygonsOf(f.geometry))

/**
 * The historical units of one year, one per name — a unit filed in several features is one unit —
 * named as they were that year (`curation.mjs`), units of a year that no longer existed left out,
 * and the units the source does not draw carved from another year's outlines.
 */
function unitsOf(sources, year) {
  const collection = sources[year]
  const curation = { drop: [], names: {}, carve: [], ...CURATION[year] }
  const byName = new Map()
  for (const f of collection.features) {
    const polygons = polygonsOf(f.geometry)
    if (polygons.length === 0) continue
    // Land the source names no one for — Antarctica, gaps in the desert — is not a unit: a gap
    // goes to the unit beside it, and Antarctica keeps its modern name.
    const source = String(f.properties?.NAME ?? f.properties?.SUBJECTO ?? '').trim()
    if (!source || curation.drop.includes(source)) continue
    const name = curation.names[source] ?? source
    const id = slug(name)
    const known = byName.get(id)
    if (known) known.polygons.push(...polygons)
    else byName.set(id, { id, name, subject: f.properties?.SUBJECTO ?? null, polygons: [...polygons] })
  }
  for (const carve of curation.carve) {
    const from = carve.from[0] === 'admin1' ? sources.admin1[carve.from[1].join()] : outlineOf(sources[carve.from[0]], carve.from[1])
    if (from.length === 0) throw new Error(`carve ${carve.name}: no ${carve.from[1]} in ${carve.from[0]}`)
    let polygons = clipper.union(from)
    for (const [y, name] of carve.minus ?? []) polygons = clipper.difference(polygons, outlineOf(sources[y], name))
    if (carve.within) polygons = clipper.intersection(polygons, outlineOf(collection, carve.within))
    // Carved into a unit the source has (East Prussia into Germany), or a unit of its own.
    const id = slug(carve.name)
    const known = byName.get(id)
    if (known) known.polygons.push(...polygons)
    else byName.set(id, { id, name: carve.name, subject: null, polygons })
  }
  return [...byName.values()].map((u) => ({ ...u, bounds: boundsOf(u.polygons) }))
}

/** Whether unit `a` keeps the land it overlaps with unit `b` (`prefer` in `curation.mjs`). */
function preferences(year) {
  const wins = new Map()
  for (const [winner, losers] of Object.entries(CURATION[year]?.prefer ?? {})) wins.set(slug(winner), new Set(losers.map(slug)))
  return (a, b) => wins.get(a)?.has(b) ?? false
}

/**
 * `moves` in `curation.mjs`: within one modern country, a unit's land (or all of it) given to
 * another unit, made for the purpose when the source has none — where the source's coarse border
 * runs through a city, or it leaves out a state the modern map draws exactly.
 */
function moved(year, pieces, units, report) {
  const byId = new Map(units.map((u) => [u.id, u]))
  for (const move of CURATION[year]?.moves ?? []) {
    const id = slug(move.to)
    let target = byId.get(id)
    if (!target) byId.set(id, (target = { id, name: move.to, subject: null }))
    let km2 = 0
    for (const piece of pieces) {
      if (piece.baseId !== move.base) continue
      if (move.from && slug(move.from) !== piece.unit?.id) continue
      piece.unit = target
      km2 += areaKm2(piece.polygons)
    }
    if (km2 === 0) throw new Error(`move ${move.base} ${move.from ?? '*'} -> ${move.to}: nothing there`)
    report.moves.push({ ...move, km2: Math.round(km2) })
  }
}

function buildYear(year, sources) {
  const units = unitsOf(sources, year)
  const beats = preferences(year)
  const report = { year, units: units.length, unclaimed: [], failures: [], overlaps: [], overlapsKm2: 0, reconciledKm2: 0, badMerges: [], moves: [], stripsKm2: 0 }
  const bases = modernFeatures.map((f) => ({ id: String(f.id), polygons: polygonsOf(f.geometry).map(oriented) }))
  const pieces = []
  for (const base of bases) pieces.push(...cutBase(base, units, report, beats))
  moved(year, pieces, units, report)
  node(pieces, clipper.created)

  // Each entity's pieces, joined exactly; and where its land lies, for its regions.
  const entities = new Map()
  for (const piece of pieces) {
    // A modern territory no unit reaches: its name and ruler that year, where `ISLANDS` knows it.
    const island = piece.unit ? null : ISLANDS[piece.baseId]?.[year]
    const id = piece.unit ? piece.unit.id : island ? slug(island) : piece.baseId
    let entity = entities.get(id)
    if (!entity) {
      const modern = modernMeta[piece.baseId]
      entity = piece.unit
        ? { id, name: piece.unit.name, subject: piece.unit.subject, pieces: [], areaBy: new Map() }
        : island
          ? { id, name: island, subject: null, pieces: [], areaBy: new Map() }
          : { id, name: modern?.name ?? id, subject: null, modern: piece.baseId, pieces: [], areaBy: new Map() }
      entities.set(id, entity)
    }
    // Every ring simple and wound d3's way before the merge (`europe/unpinch.mjs`): Natural Earth's
    // outlines touch themselves here and there, and a merge across a pinched ring took most of
    // the United States for holes.
    entity.pieces.push(unpinched(piece.polygons).polygons.map(oriented))
    entity.areaBy.set(piece.baseId, (entity.areaBy.get(piece.baseId) ?? 0) + areaKm2(piece.polygons))
  }

  const features = []
  const meta = {}
  for (const entity of entities.values()) {
    const polygons = dissolve(entity.pieces)
    if (polygons.length === 0) continue
    const area = [...entity.areaBy.values()].reduce((a, b) => a + b, 0)
    // Joined, a unit is exactly the sum of its pieces; anything else is a broken merge.
    const joined = areaKm2(polygons)
    if (Math.abs(joined - area) > Math.max(1, area * 0.001)) report.badMerges.push({ id: entity.id, pieces: Math.round(area), joined: Math.round(joined) })
    const ranked = [...entity.areaBy.entries()].sort((a, b) => b[1] - a[1])
    const main = modernMeta[ranked[0][0]]
    const regions = new Set()
    for (const [baseId, a] of ranked) {
      if (a >= REGION_KM2 || a >= REGION_SHARE * area) for (const r of presetsOf(modernMeta[baseId])) regions.add(r)
    }
    const [lng, lat] = interiorPoint(polygons) ?? [0, 0]
    const modern = entity.modern ? modernMeta[entity.modern] : null
    features.push({ type: 'Feature', id: entity.id, properties: { name: entity.name }, geometry: { type: 'MultiPolygon', coordinates: polygons } })
    meta[entity.id] = {
      id: entity.id,
      iso2: modern?.iso2 ?? null,
      code: modern?.code ?? entity.id.toUpperCase().slice(0, 6),
      numeric: null,
      name: entity.name,
      officialName: entity.name,
      region: main?.region ?? 'Other',
      subregion: main?.subregion ?? 'Other',
      regions: [...regions],
      // A colony is named "Place (Ruler)".
      independent: !entity.name.includes('('),
      lat: Number(lat.toFixed(3)),
      lng: Number(lng.toFixed(3)),
      areaKm2: Math.round(area),
    }
  }
  report.entities = features.length
  // Every unit of the year is on the map, and each is exactly the sum of its pieces.
  const lost = units.filter((u) => !meta[u.id]).map((u) => u.name)
  if (lost.length) throw new Error(`${year}: units lost: ${lost.join(', ')}`)
  if (report.badMerges.length) throw new Error(`${year}: broken merges: ${JSON.stringify(report.badMerges)}`)
  report.overlapsKm2 = Math.round(report.overlapsKm2)
  report.reconciledKm2 = Math.round(report.reconciledKm2)
  report.stripsKm2 = Math.round(report.stripsKm2)
  return { features, meta, report }
}

/* ---------------------------------------------------------------- 1990 */

/** The states of 1990 made of several modern countries, and what each was called. */
const UNIONS_1990 = [
  { id: 'SUN', name: 'Soviet Union', officialName: 'Union of Soviet Socialist Republics', flag: 'x-ussr', members: ['RUS', 'UKR', 'BLR', 'EST', 'LVA', 'LTU', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'] },
  { id: 'YUG', name: 'Yugoslavia', officialName: 'Socialist Federal Republic of Yugoslavia', flag: 'x-yug', members: ['SRB', 'HRV', 'SVN', 'BIH', 'MNE', 'MKD', 'XKX', 'KOS'] },
  { id: 'CSK', name: 'Czechoslovakia', officialName: 'Czech and Slovak Federative Republic', flag: 'cz', members: ['CZE', 'SVK'] },
  { id: 'ETH', name: 'Ethiopia', officialName: "People's Democratic Republic of Ethiopia", flag: null, members: ['ETH', 'ERI'] },
  { id: 'SDN', name: 'Sudan', officialName: 'Republic of the Sudan', flag: 'sd', members: ['SDN', 'SSD'] },
  { id: 'SOM', name: 'Somalia', officialName: 'Somali Democratic Republic', flag: 'so', members: ['SOM', 'SOL'] },
]
/** Called otherwise in 1990. */
const NAMES_1990 = { COD: 'Zaire', SWZ: 'Swaziland', CPV: 'Cape Verde', TUR: 'Turkey', TLS: 'East Timor', HKG: 'Hong Kong (UK)', MAC: 'Macau (Portugal)' }
/** Flew another flag in 1990 than today: no flag, rather than today's. */
const OTHER_FLAG_1990 = new Set(['AFG', 'LBY', 'IRQ', 'ZAF', 'RWA', 'COD', 'MMR', 'VEN', 'LSO', 'MNG', 'ALB', 'CPV', 'KHM', 'TLS', 'HKG', 'MAC', 'MRT', 'COG', 'COM', 'SYC', 'BHR'])

function build1990() {
  const geometries = modernTopology.objects.countries.geometries
  const memberOf = new Map()
  for (const union of UNIONS_1990) for (const id of union.members) memberOf.set(id, union)
  const features = []
  const meta = {}
  const done = new Set()
  for (const g of geometries) {
    const id = String(g.id)
    const union = memberOf.get(id)
    if (union) {
      if (done.has(union.id)) continue
      done.add(union.id)
      const members = geometries.filter((m) => union.members.includes(String(m.id)))
      const merged = topojsonClient.merge(modernTopology, members)
      const lead = modernMeta[union.members[0]]
      const [lng, lat] = interiorPoint(merged.coordinates) ?? [0, 0]
      features.push({ type: 'Feature', id: union.id, properties: { name: union.name }, geometry: merged })
      meta[union.id] = {
        id: union.id,
        iso2: union.flag,
        code: union.id,
        numeric: null,
        name: union.name,
        officialName: union.officialName,
        region: lead?.region ?? 'Other',
        subregion: lead?.subregion ?? 'Other',
        independent: true,
        lat: Number(lat.toFixed(3)),
        lng: Number(lng.toFixed(3)),
      }
      continue
    }
    const modern = modernMeta[id]
    if (!modern) continue
    features.push({ type: 'Feature', id, properties: { name: NAMES_1990[id] ?? modern.name }, geometry: topojsonClient.feature(modernTopology, g).geometry })
    meta[id] = {
      ...modern,
      name: NAMES_1990[id] ?? modern.name,
      officialName: NAMES_1990[id] ?? modern.officialName,
      iso2: OTHER_FLAG_1990.has(id) ? null : modern.iso2,
    }
  }
  return { features, meta, report: { year: 1990, entities: features.length } }
}

/* -------------------------------------------------------------- output */

function write(year, { features, meta, report }) {
  const topology = topojsonServer.topology({ countries: { type: 'FeatureCollection', features } }, QUANTIZATION)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, `world-${year}.json`), JSON.stringify(topology))
  writeFileSync(
    resolve(outDir, `world-${year}-meta.json`),
    JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), numericToId: {}, nameToId: {}, entities: meta }),
  )
  log(`${year}: ${report.entities} entities`, JSON.stringify({ ...report, failures: report.failures?.length ?? 0, unclaimed: report.unclaimed?.length ?? 0 }))
  return report
}

const sources = {}
for (const year of SOURCE_YEARS) sources[year] = await source(year)
sources.admin1 = {}
for (const year of YEARS) {
  for (const carve of CURATION[year]?.carve ?? []) {
    if (carve.from[0] === 'admin1') sources.admin1[carve.from[1].join()] = await admin1Outline(carve.from[1])
  }
}
const reports = []
for (const year of YEARS) {
  clipper.created.length = 0
  reports.push(write(year, buildYear(year, sources)))
}
reports.push(write(1990, build1990()))
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(reports, null, 1))
log('done ->', outDir)
