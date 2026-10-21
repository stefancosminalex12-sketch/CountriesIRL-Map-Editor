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
import { healSeams } from './heal.mjs'
import { countriesOf, fetchDay } from './ohm.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cacheDir = resolve(root, '.cache/hist-src')
const outDir = resolve(root, 'data/historical')
const REFRESH = process.argv.includes('--refresh')
const SOURCE = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/'
/** `--years=1938,1945` builds only those (and 1990, which is quick). */
const ONLY = process.argv.find((a) => a.startsWith('--years='))
const YEARS = [1914, 1938, 1945].filter((y) => !ONLY || ONLY.slice(8).split(',').includes(String(y)))
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
/**
 * The same seam with OpenHistoricalMap's borders, which are traced at the scale of a topographic
 * map: an unchanged border lies within a kilometre or two of the modern one.
 */
const OHM_STRIP_WIDTH_KM = 2
/** A unit this small is never a seam, whatever its width. */
const SMALL_UNIT_KM2 = 5000
const STRIP_SHARED = 0.25

const log = (...args) => console.log('[historical]', ...args)

/* ---------------------------------------------------------------- inputs */

/**
 * The modern map the years are cut into: 25m by default, or `--detail=10m` for the detailed one,
 * whose borders stay curved when zoomed in (25m draws them in straight runs of 20–60 km). The 10m
 * files are written beside the 25m ones with "-10m" in their names.
 */
const DETAIL = (process.argv.find((a) => a.startsWith('--detail=')) ?? '--detail=25m').slice(9)
if (DETAIL !== '25m' && DETAIL !== '10m') throw new Error(`--detail must be 25m or 10m, not ${DETAIL}`)
const SUFFIX = DETAIL === '25m' ? '' : `-${DETAIL}`
const modernTopology = JSON.parse(readFileSync(resolve(root, `data/natural-earth/countries-${DETAIL}.json`), 'utf8'))
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
  if (m.region === 'Asia' || m.id === 'RUS') out.push('asia')
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
function cutBase(base, units, report, beats, stripKm = STRIP_WIDTH_KM) {
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
      // A small state is never a seam: Monaco or Pondicherry is narrow because it is small.
      if (self > 0 && width < stripKm && !(part.unit.areaKm2 < SMALL_UNIT_KM2) && sharedShare(p, self) >= STRIP_SHARED) {
        report.stripsKm2 += area
        loose.push(p)
        return
      }
      const seam = area < SCRAP_KM2 || (width < SLIVER_WIDTH_KM && area < SLIVER_MAX_AREA_KM2)
      if (k === 0 || !seam) part.polygons.push(p)
      else loose.push(p)
    })
  })
  // What no part holds — less the scraps and strips already set aside above. Without them taken
  // off too, a strip was handed out twice (once itself, once inside the residual), sometimes to two
  // different units: they overlapped there, neither outline was the other's, and the border
  // between them was not drawn (Czechoslovakia and Germany in 1945, near 13.9° E 50.8° N).
  const residual = safely(() => clipper.difference(base.polygons, ...parts.map((p) => p.polygons), loose))
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
function moved(year, pieces, units, report, moves = CURATION[year]?.moves ?? [], strict = true) {
  const byId = new Map(units.map((u) => [u.id, u]))
  for (const move of moves) {
    const id = slug(move.to)
    let target = byId.get(id)
    if (!target) byId.set(id, (target = { id, name: move.to, subject: null }))
    let km2 = 0
    const added = []
    if (process.env.HIST_DEBUG_BASE === move.base) console.log('[move]', JSON.stringify(move), JSON.stringify(pieces.filter((p) => p.baseId === move.base).map((p) => `${p.unit?.id}|${p.unit?.name}|${Math.round(areaKm2(p.polygons))}`)))
    for (const piece of pieces) {
      if (piece.baseId !== move.base) continue
      // By name too: a unit filled in from historical-basemaps keeps that source's id.
      if (move.from && slug(move.from) !== piece.unit?.id && move.from !== piece.unit?.name) continue
      if (move.southOf !== undefined) {
        // Only the land south of the parallel moves, cut along it: a border that was a parallel.
        const south = [[[-180, -90], [180, -90], [180, move.southOf], [-180, move.southOf], [-180, -90]]]
        const below = clipper.intersection(piece.polygons, [south])
        if (areaKm2(below) <= 0) continue
        piece.polygons = despiked(closeRings(clipper.difference(piece.polygons, [south]))).map(oriented)
        added.push({ unit: target, baseId: piece.baseId, polygons: despiked(closeRings(below)).map(oriented) })
        km2 += areaKm2(below)
        continue
      }
      piece.unit = target
      km2 += areaKm2(piece.polygons)
    }
    pieces.push(...added)
    if (km2 === 0 && strict) throw new Error(`move ${move.base} ${move.from ?? '*'} -> ${move.to}: nothing there`)
    if (km2 === 0) continue
    report.moves.push({ ...move, km2: Math.round(km2) })
  }
}


/**
 * A country's land overseas, shown as the colony it was: OpenHistoricalMap files Suriname inside
 * the Netherlands and Papua inside Australia, where world maps — and the curated maps before —
 * show "Suriname (Netherlands)". Land of a unit not joined by land to its main part (by modern
 * countries' shared borders) becomes a unit of its own, per modern country: named as the curated
 * unit there, else as `ISLANDS` names it, else "Country (Ruler)". Only the colonial powers, by their
 * homeland (`HOME_BASE`): Oman keeps Gwadar, China Taiwan, the Empire of Japan Korea and Karafuto.
 * A sliver of a power on a country another unit holds is a seam, and goes to that unit.
 */
const HOME_BASE = {
  Netherlands: 'NLD', France: 'FRA', Denmark: 'DNK', Australia: 'AUS', Spain: 'ESP', Portugal: 'PRT',
  'United States': 'USA', 'United Kingdom': 'GBR', 'United Kingdom of Great Britain and Ireland': 'GBR',
  Italy: 'ITA', Belgium: 'BEL', 'New Zealand': 'NZL', 'German Empire': 'DEU', Norway: 'NOR',
  'Union of South Africa': 'ZAF', Argentina: 'ARG',
}
/**
 * A colony's name where neither the curated maps nor `ISLANDS` give it right: the Canal Zone, Sint
 * Maarten in the Netherlands Antilles. `null` leaves the land to no one: Australia's Antarctic claim
 * is Antarctica on these maps, as every other claim is.
 */
const COLONY_NAMES = {
  'PAN|United States': 'Panama Canal Zone (USA)',
  'SXM|Netherlands': 'Netherlands Antilles (Netherlands)',
  'ATA|Australia': null,
  // The Coral Sea Islands Territory dates from 1969.
  'XCS|Australia': null,
}
/** A power holding less of a country than this, where another unit holds more, has a seam there. */
const SEAM_SHARE = 0.3
const RULERS = {
  'United Kingdom': 'UK',
  'United Kingdom of Great Britain and Ireland': 'UK',
  'Russian Empire': 'Russia',
  'United States': 'USA',
  'German Empire': 'Germany',
  'Empire of Japan': 'Japan',
}
const modernNeighbours = (() => {
  const geometries = modernTopology.objects.countries.geometries
  const lists = topojsonClient.neighbors(geometries)
  const out = new Map()
  geometries.forEach((g, i) => out.set(String(g.id), new Set(lists[i].map((j) => String(geometries[j].id)))))
  return out
})()

function splitOverseas(year, pieces, curatedUnits, report) {
  const byUnit = new Map()
  for (const piece of pieces) {
    if (!piece.unit || !HOME_BASE[piece.unit.name]) continue
    const list = byUnit.get(piece.unit.id) ?? []
    list.push(piece)
    byUnit.set(piece.unit.id, list)
  }
  const made = new Map()
  report.overseas = []
  // What each modern country is made of: how much of it each unit holds.
  const held = new Map()
  for (const p of pieces) {
    if (!p.unit) continue
    const m = held.get(p.baseId) ?? new Map()
    m.set(p.unit.id, (m.get(p.unit.id) ?? 0) + areaKm2(p.polygons))
    held.set(p.baseId, m)
  }
  const unitById = new Map(pieces.filter((p) => p.unit).map((p) => [p.unit.id, p.unit]))
  for (const list of byUnit.values()) {
    const area = new Map()
    for (const p of list) area.set(p.baseId, (area.get(p.baseId) ?? 0) + areaKm2(p.polygons))
    if (area.size < 2) continue
    // The unit's own corners in each modern country: two of its pieces share a border only where
    // they share points, being cut from one set of modern borders.
    const corners = new Map()
    for (const p of list) {
      const set = corners.get(p.baseId) ?? new Set()
      for (const polygon of p.polygons) for (const ring of polygon) for (const [x, y] of ring) set.add(`${x.toFixed(6)},${y.toFixed(6)}`)
      corners.set(p.baseId, set)
    }
    const touches = (a, b) => {
      let shared = 0
      for (const k of corners.get(a)) if (corners.get(b).has(k) && ++shared >= 2) return true
      return false
    }
    // The unit's modern countries in groups joined by land; the largest group is its main part.
    const seen = new Set()
    const groups = []
    for (const start of area.keys()) {
      if (seen.has(start)) continue
      const group = []
      const queue = [start]
      seen.add(start)
      while (queue.length) {
        const b = queue.pop()
        group.push(b)
        // Only where the unit's own land meets: modern France borders Suriname through French
        // Guiana, but the Netherlands' sliver of France is in Europe.
        for (const n of modernNeighbours.get(b) ?? []) if (area.has(n) && !seen.has(n) && touches(b, n)) (seen.add(n), queue.push(n))
      }
      groups.push({ bases: group, km2: group.reduce((s, b) => s + area.get(b), 0) })
    }
    if (groups.length < 2) continue
    const unit = list[0].unit
    // The homeland's group is the main part, however much larger a colony is (Suriname, Greenland).
    groups.sort((a, b) => (b.bases.includes(HOME_BASE[unit.name]) ? 1 : 0) - (a.bases.includes(HOME_BASE[unit.name]) ? 1 : 0) || b.km2 - a.km2)
    const ruler = RULERS[unit.name] ?? unit.name
    for (const group of groups.slice(1)) {
      for (const baseId of group.bases) {
        const here = list.filter((p) => p.baseId === baseId)
        const polygons = here.flatMap((p) => p.polygons)
        // A seam: the land goes to the unit holding most of the country.
        const shares = [...(held.get(baseId) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])
        const total = shares.reduce((s, [, a]) => s + a, 0)
        const key = `${baseId}|${unit.name}`
        if (key in COLONY_NAMES && COLONY_NAMES[key] === null) {
          for (const p of here) p.unit = null
          continue
        }
        const fixed = COLONY_NAMES[key]
        if (!fixed && shares.length && shares[0][0] !== unit.id && area.get(baseId) < SEAM_SHARE * total) {
          const owner = unitById.get(shares[0][0])
          for (const p of here) p.unit = owner
          report.overseas.push(`${modernMeta[baseId]?.name ?? baseId}: ${unit.name} seam -> ${owner.name}`)
          continue
        }
        let name = fixed ?? ISLANDS[baseId]?.[year] ?? null
        let bestKm2 = 0
        for (const u of name ? [] : curatedUnits) {
          if (u.name === unit.name || !boxesMeet(u.bounds, boundsOf(polygons))) continue
          const shared = safely(() => clipper.intersection(polygons, u.polygons))
          if (shared.error) continue
          const km2 = areaKm2(shared)
          if (km2 > bestKm2) (bestKm2 = km2, (name = u.name))
        }
        if (!name && !(bestKm2 >= 0.5 * area.get(baseId))) name = `${modernMeta[baseId]?.name ?? baseId} (${ruler})`
        const id = slug(name)
        let target = made.get(id)
        if (!target) made.set(id, (target = { id, name, subject: null }))
        for (const p of here) p.unit = target
        report.overseas.push(`${modernMeta[baseId]?.name ?? baseId}: ${unit.name} -> ${name}`)
      }
    }
  }
}

/** An island this far from its power's homeland, in the homeland's own modern country, is a colony. */
const FAR_KM = 5000

const kmBetween = ([x1, y1], [x2, y2]) => {
  const r = Math.PI / 180
  const h = Math.sin(((y2 - y1) * r) / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(((x2 - x1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Land of a colonial power inside its homeland's modern country but an ocean away: the modern
 * Netherlands includes Bonaire, which OpenHistoricalMap files in the Netherlands. It becomes the
 * curated unit it lies in (the Netherlands Antilles); with none there, it stays.
 */
function splitFar(pieces, curatedUnits, report) {
  report.far = []
  for (const [power, home] of Object.entries(HOME_BASE)) {
    const here = pieces.filter((p) => p.baseId === home && p.unit?.name === power)
    const all = here.flatMap((p) => p.polygons)
    if (all.length < 2) continue
    const main = all.reduce((a, b) => (polygonAreaKm2(b) > polygonAreaKm2(a) ? b : a))
    for (const piece of here) {
      const keep = []
      for (const polygon of piece.polygons) {
        let near = Infinity
        if (polygon !== main) for (const point of main[0]) near = Math.min(near, kmBetween(polygon[0][0], point))
        if (polygon === main || near < FAR_KM) {
          keep.push(polygon)
          continue
        }
        let owner = null
        let bestKm2 = 0
        const box = boundsOf([polygon])
        for (const u of curatedUnits) {
          if (u.name === power || !boxesMeet(u.bounds, box)) continue
          const shared = safely(() => clipper.intersection([polygon], u.polygons))
          if (shared.error) continue
          const km2 = areaKm2(shared)
          if (km2 > bestKm2) (bestKm2 = km2, (owner = u))
        }
        if (!owner || bestKm2 < 0.5 * polygonAreaKm2(polygon)) {
          keep.push(polygon)
          continue
        }
        pieces.push({ unit: { id: owner.id, name: owner.name, subject: owner.subject ?? null }, baseId: home, polygons: [polygon] })
        report.far.push(`${power} -> ${owner.name} ${Math.round(polygonAreaKm2(polygon))} km²`)
      }
      piece.polygons = keep
    }
  }
}

function buildYear(year, sources, units = unitsOf(sources, year), curated = true, partBeats = null, curatedUnits = null) {
  // OpenHistoricalMap's parts win inside their ruler; the curated rules settle the units filled from historical-basemaps.
  const curatedBeats = preferences(year)
  const beats = curated ? curatedBeats : (a, b) => (partBeats?.(a, b) ?? false) || curatedBeats(a, b)
  const report = { year, units: units.length, unclaimed: [], failures: [], overlaps: [], overlapsKm2: 0, reconciledKm2: 0, badMerges: [], moves: [], stripsKm2: 0 }
  const bases = modernFeatures.map((f) => ({ id: String(f.id), polygons: polygonsOf(f.geometry).map(oriented) }))
  const pieces = []
  for (const base of bases) pieces.push(...cutBase(base, units, report, beats, curated ? STRIP_WIDTH_KM : OHM_STRIP_WIDTH_KM))
  if (curated) moved(year, pieces, units, report)
  else {
    moved(year, pieces, units, report, [...OHM_MOVES, ...(OHM_YEAR_MOVES[year] ?? [])], false)
    // Antarctica is no one's on these maps: every claim to it, as Madagascar's Adélie Land, is left out.
    for (const p of pieces) if (p.baseId === 'ATA') p.unit = null
    splitFar(pieces, curatedUnits ?? [], report)
    splitOverseas(year, pieces, curatedUnits ?? [], report)
  }
  node(pieces, clipper.created)
  // And the borders that run a few metres apart made one line, so every one is drawn (`heal.mjs`).
  report.healed = healSeams(pieces)

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
        ? { id, name: piece.unit.name, subject: piece.unit.subject, own: piece.unit.own, pieces: [], areaBy: new Map() }
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
    // OpenHistoricalMap's units may close a sliver between their own pieces (Luxembourg's border rivers): a little more land joined, never less.
    const slack = curated || joined < area ? Math.max(1, area * 0.001) : Math.max(100, area * 0.03)
    if (Math.abs(joined - area) > slack) report.badMerges.push({ id: entity.id, pieces: Math.round(area), joined: Math.round(joined), by: Object.fromEntries([...entity.areaBy].map(([k, v]) => [k, Math.round(v)])), pieceAreas: entity.pieces.map((p) => Math.round(areaKm2(p))) })
    const ranked = [...entity.areaBy.entries()].sort((a, b) => b[1] - a[1])
    const main = modernMeta[ranked[0][0]]
    const regions = new Set()
    for (const [baseId, a] of ranked) {
      if (a >= REGION_KM2 || a >= REGION_SHARE * area) for (const r of presetsOf(modernMeta[baseId])) regions.add(r)
    }
    const [lng, lat] = interiorPoint(polygons) ?? [0, 0]
    const modern = entity.modern ? modernMeta[entity.modern] : null
    // A country OpenHistoricalMap names in its own style ("Colony of the Bahamas") takes the islands' curated name where there is one: "Bahamas (UK)".
    if (entity.own && ISLANDS[ranked[0][0]]?.[year]) entity.name = ISLANDS[ranked[0][0]][year]
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
      // The modern country with most of its land, which it answers Yes or No in the language of.
      modern: ranked[0][0],
      // A colony is named "Place (Ruler)".
      independent: !entity.name.includes('('),
      lat: Number(lat.toFixed(3)),
      lng: Number(lng.toFixed(3)),
      areaKm2: Math.round(area),
    }
  }
  // Once more on the countries as joined: an edge two pieces of one country shared before the join
  // is gone after it, and a spike it hid is a seam now (Luxembourg and the French zone in 1945).
  report.healed += healSeams(features.map((f) => ({ polygons: f.geometry.coordinates })))
  report.entities = features.length
  // Every unit of the year is on the map, and each is exactly the sum of its pieces.
  // A unit only filled in from historical-basemaps may come to nothing — its land is OpenHistoricalMap's after all.
  const lost = units.filter((u) => !meta[u.id] && (curated || u.ohm)).map((u) => u.name)
  report.fillsGone = units.filter((u) => !meta[u.id] && !curated && !u.ohm).map((u) => u.name)
  if (lost.length) throw new Error(`${year}: units lost: ${lost.join(', ')}`)
  if (report.badMerges.length) throw new Error(`${year}: broken merges: ${JSON.stringify(report.badMerges)}`)
  report.overlapsKm2 = Math.round(report.overlapsKm2)
  report.reconciledKm2 = Math.round(report.reconciledKm2)
  report.stripsKm2 = Math.round(report.stripsKm2)
  return { features, meta, report }
}

/* ------------------------------------------------- OpenHistoricalMap */

/**
 * The day each year's map shows, from OpenHistoricalMap: 1914 on the eve of the First World War,
 * 1938 at its end — after Munich and the First Vienna Award, before the Second World War — and
 * 1945 at its end, Germany and Austria under occupation.
 */
const OHM_DATES = { 1914: '1914-07-01', 1938: '1938-12-31', 1945: '1945-12-31' }
/** A country inside another this much is one of its parts (a Malay state in British Malaya). */
const PART_OF = 0.9
/** An OpenHistoricalMap country takes the curated name of the unit it shares this much with. */
const NAMED_FROM = 0.5
/** Land OpenHistoricalMap leaves to no one is filled from historical-basemaps from this size… */
const FILL_MIN_KM2 = 300
/** …and this width (twice the area over the perimeter): narrower, it is a seam, not a gap. */
const FILL_MIN_WIDTH_KM = 6
/**
 * Federations and protectorates shown whole, as world maps show them: the colonies and
 * sultanates OpenHistoricalMap also files inside them are their parts, not countries of their own.
 */
const SHOWN_WHOLE = new Set(['French West Africa', 'French Equatorial Africa', 'Indochinese Union', 'Upper Senegal and Niger', 'US Philippines', 'Aden Protectorate', 'British Malaya', 'Federated Malay States'])
/**
 * Where two of OpenHistoricalMap's countries claim the same land, the first keeps it: Labrador,
 * Newfoundland's from 1809 (confirmed in 1927), which it also draws inside Canada.
 */
/** A name with its ruler and the words every state has left out, for matching: "Kingdom of Romania" is "romania". */
const nameKey = (name) =>
  String(name)
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/\b(kingdom|empire|republic|colony|protectorate|dominion|tsardom|sultanate|emirate|territory|state|crown|the|of|and)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()

/** Not countries on a world map: the German–Luxembourg condominium is the border rivers themselves. */
const OHM_DROP = new Set([
  'Germany-Luxembourg condominium',
  // Treaty-port concessions, a few streets each: on a world map their land is China's.
  'British concession in Tianjin', 'British Concession of Jiujiang', 'British concession of Hankou',
  'Belgian concession of Tianjin', 'British Leased Liugong Island',
])
/** Relations whose English name is another country's: OpenHistoricalMap's Leeward Islands are tagged "British Guiana". */
const OHM_RELATION_NAMES = { 2832972: 'Leeward Islands (UK)', 2832971: 'Leeward Islands (UK)' }
/** OpenHistoricalMap's names for the curated ones, where no word of the two is shared: the French Republic is France. */
const OHM_ALIASES = { 'French Republic': 'France', 'Kingdom of the Netherlands': 'Netherlands' }
/**
 * Land OpenHistoricalMap files in its metropole, shown as the colony world maps show: Algeria,
 * three French départements from 1848, as "Algeria (France)" (`moves`, by modern country).
 */
const OHM_MOVES = [
  { base: 'DZA', from: 'France', to: 'Algeria (France)' },
  // The Spanish protectorate in Morocco, which OpenHistoricalMap files in Spain.
  { base: 'MAR', from: 'Spain', to: 'Spanish Morocco (Spain)' },
  // Monaco, drawn a little off the modern map's Monaco: its land there, and none of France's.
  { base: 'MCO', to: 'Monaco' },
  { base: 'FRA', from: 'Monaco', to: 'France' },
]
/** The same, year by year: Finland, a grand duchy of the Russian Empire in 1914; South West Africa, a South African mandate. */
const OHM_YEAR_MOVES = {
  1914: [
    { base: 'FIN', from: 'Russian Empire', to: 'Finland (Russia)' },
    { base: 'ALA', from: 'Russian Empire', to: 'Finland (Russia)' },
    { base: 'PNG', from: 'Australia', to: 'Papua (Australia)' },
    // The Bogd Khanate, independent of China since 1911, and Qatar, which the Ottomans gave up in 1913.
    { base: 'MNG', from: 'China', to: 'Mongolia' },
    { base: 'QAT', from: 'Ottoman Empire', to: 'Qatar' },
    // All of today's Western Sahara was the Spanish colony (Río de Oro and Saguia el-Hamra), whatever
    // OpenHistoricalMap files its parts under: Spain, or its protectorate in Morocco.
    { base: 'ESH', to: 'Río de Oro (Spain)' },
    // North of Western Sahara as the modern map draws it, the colony ran to 27°40′ N (Laayoune);
    // the strip beyond it, Cape Juby, was the protectorate's southern zone.
    { base: 'MAR', from: 'Spanish Morocco (Spain)', to: 'Río de Oro (Spain)', southOf: 27 + 40 / 60 },
  ],
  1938: [
    { base: 'NAM', from: 'Union of South Africa', to: 'South West Africa (South Africa)' },
    { base: 'PNG', from: 'Australia', to: 'Papua and New Guinea (Australia)' },
    // Japan's League of Nations mandate, not Japan.
    ...['FSM', 'MNP', 'MHL', 'PLW'].map((base) => ({ base, from: 'Empire of Japan', to: 'South Seas Mandate (Japan)' })),
    { base: 'ESH', to: 'Spanish Sahara (Spain)' },
    // North of Western Sahara as the modern map draws it, the colony ran to 27°40′ N (Laayoune);
    // the strip beyond it, Cape Juby, was the protectorate's southern zone.
    { base: 'MAR', from: 'Spanish Morocco (Spain)', to: 'Spanish Sahara (Spain)', southOf: 27 + 40 / 60 },
    // French Togoland, a mandate of its own that OpenHistoricalMap files in French West Africa.
    { base: 'TGO', from: 'French West Africa (France)', to: 'Togoland (UK and France)' },
  ],
  1945: [
    { base: 'NAM', from: 'Union of South Africa', to: 'South West Africa (South Africa)' },
    { base: 'PNG', from: 'Australia', to: 'Papua and New Guinea (Australia)' },
    // The islands the United States took from Japan, which OpenHistoricalMap files in occupied Japan.
    { base: 'FSM', from: 'Japan (USA)', to: 'Caroline Islands (USA)' },
    { base: 'MHL', from: 'Japan (USA)', to: 'Marshall Islands (USA)' },
    { base: 'PLW', from: 'Japan (USA)', to: 'Palau (USA)' },
    { base: 'MNP', from: 'Japan (USA)', to: 'Mariana Islands (USA)' },
    { base: 'ESH', to: 'Spanish Sahara (Spain)' },
    // North of Western Sahara as the modern map draws it, the colony ran to 27°40′ N (Laayoune);
    // the strip beyond it, Cape Juby, was the protectorate's southern zone.
    { base: 'MAR', from: 'Spanish Morocco (Spain)', to: 'Spanish Sahara (Spain)', southOf: 27 + 40 / 60 },
    { base: 'TGO', from: 'French West Africa (France)', to: 'Togoland (UK and France)' },
  ],
}
/** OpenHistoricalMap's own names, in the maps' style where no curated name was found. */
const OHM_RENAME = {
  'Colony of the Straits Settlement': 'Straits Settlements (UK)',
  'Lebanese Republic': 'Lebanon (France)',
  'Aden Colony': 'Aden (UK)',
  'Protectorate of Kuwait': 'Kuwait (UK)',
  'British Kenya': 'Kenya (UK)',
  'Kingdom of Iceland': 'Iceland',
  // Two colonies until 1934, shown as the one Libya world maps show.
  'Italian Cyrenaica': 'Libya (Italy)',
  'Italian Tripolitania': 'Libya (Italy)',
  'British Honduras Colony': 'British Honduras (UK)',
  'Commonwealth of the Philippines': 'Philippines (USA)',
  'Democratic Government of Albania': 'Albania',
  'British Military Administration of Malaya': 'Malaya (UK)',
  'Northern Rhodesia': 'Northern Rhodesia (UK)',
  'British Protectorate of Sarawak': 'Sarawak (UK)',
  'Protectorate of Kenya': 'Kenya (UK)',
  // The main part of a colony whose other parts are named for it below.
  'Portuguese Angola': 'Angola (Portugal)',
  'Gold Coast Colony': 'Gold Coast (UK)',
  'Italian Somaliland': 'Italian Somaliland (Italy)',
  'British Hong Kong': 'Hong Kong (UK)',
  'Colony of Guadelupe': 'Guadeloupe (France)',
  'La Réunion': 'Réunion (France)',
  'Colony of Madagascar and Dependencies': 'Madagascar (France)',
  'British Windward Islands': 'Windward Islands (UK)',
  'Colony of Jamaica': 'Jamaica (UK)',
  'Colony of the Bahamas': 'Bahamas (UK)',
  'Trinidad and Tobago Colony': 'Trinidad and Tobago (UK)',
  'British Occupation of Cyprus': 'Cyprus (UK)',
  'British Cyprus': 'Cyprus (UK)',
  'British Cameroons': 'British Cameroons (UK)',
  'British Togoland': 'Togoland (UK and France)',
  'British Weihaiwei': 'Weihaiwei (UK)',
  'Kiautschou Bay Leased Territory': 'Kiautschou (Germany)',
  'Italian Islands of the Aegean': 'Dodecanese (Italy)',
  'North Borneo': 'North Borneo (UK)',
  'Portuguese Timor': 'Portuguese Timor (Portugal)',
  'Portuguese India': 'Portuguese India (Portugal)',
  'French Settlements in India': 'French India (France)',
  'Zanzibar Protectorate': 'Zanzibar (UK)',
  'Tokelau Islands Protectorate': 'Tokelau (UK)',
  // Parts of a colony OpenHistoricalMap files apart, shown whole as world maps show them.
  'Ashanti Colony': 'Gold Coast (UK)',
  'Northern Territories': 'Gold Coast (UK)',
  'Protectorate of Mauritania': 'French West Africa (France)',
  'Protectorate of the Portuguese Congo': 'Angola (Portugal)',
  'Protectorate of Wituland': 'British East Africa (UK)',
  'Sultanate of Hobyo': 'Italian Somaliland (Italy)',
  'Majeerteen Sultanate': 'Italian Somaliland (Italy)',
  'Johore Protectorate': 'Malaya (UK)',
  'Kelantan Protectorate': 'Malaya (UK)',
  'Trengganu Protectorate': 'Malaya (UK)',
  'Kedah Protectorate': 'Malaya (UK)',
  'Perlis Protectorate': 'Malaya (UK)',
  'Federated Malay States': 'Malaya (UK)',
  // The Democratic Republic of Vietnam, which held the north at the end of 1945.
  'North Vietnam': 'Vietnam',
  // Brunei, Sarawak and North Borneo, one British military administration from 1945 to 1946.
  'British Military Administration of Borneo': 'British Borneo (UK administration)',
  // Back under France at the end of 1945.
  Cambodia: 'French Indochina (France)',
  Laos: 'French Indochina (France)',
}
/** Names given whatever the curated maps had there: Libya, one British administration in 1945. */
const OHM_FIXED_NAMES = {
  'British Military Administration of Libya': 'Libya (UK)',
  'British Military Administration of Somaliland': 'Somaliland (UK administration)',
}
const OHM_PREFER = {
  'Dominion of Newfoundland': ['Canada', 'Dominion of Canada'],
  'Commission Government of Newfoundland': ['Canada', 'Dominion of Canada'],
}

/**
 * A year's units from OpenHistoricalMap's borders, named as the curated historical-basemaps units
 * they correspond to — "Germany" for the German Reich, "Algeria (France)" — so the names and the
 * flags stay those of the maps already made. Each curated name goes to the country with most of
 * its land; a country matching none keeps its own name.
 */
async function ohmUnitsOf(year, sources) {
  const json = await fetchDay(OHM_DATES[year], resolve(root, '.cache/ohm'), REFRESH)
  const countries = countriesOf(json).map((c) => {
    // Rings joined from border ways can cross themselves where a border doubles back; a union
    // makes each outline simple, as the cutting and the joining need.
    const raw = c.polygons.map(oriented)
    const cleaned = safely(() => clipper.union(raw))
    const polygons = (cleaned.error ? raw : unpinched(cleaned).polygons).map(oriented)
    return { ...c, name: OHM_RELATION_NAMES[c.relation] ?? c.name, polygons, bounds: boundsOf(polygons), area: areaKm2(polygons) }
  }).filter((c) => c.area > SCRAP_KM2 && !OHM_DROP.has(c.name)).sort((a, b) => b.area - a.area)

  // A country drawn inside another's outline — a colony inside its ruler's, as OpenHistoricalMap
  // files the Philippines inside the United States — keeps its own land (`partOf`, below).
  // The same country filed twice (Newfoundland's dominion and its commission government) is one;
  // a part of a federation shown whole is left to it.
  const kept = []
  const partPairs = []
  const merged = []
  for (const c of countries) {
    let drop = false
    for (const host of kept) {
      if (!boxesMeet(host.bounds, c.bounds)) continue
      const shared = safely(() => clipper.intersection(c.polygons, host.polygons))
      if (shared.error) continue
      const km2 = areaKm2(shared)
      if (km2 < PART_OF * c.area) continue
      if (km2 >= PART_OF * host.area || SHOWN_WHOLE.has(host.name)) {
        merged.push(`${c.name} into ${host.name}`)
        drop = true
        break
      }
      partPairs.push([c, host])
    }
    if (!drop) kept.push(c)
  }
  log(`${year}: one with the country around it: ${merged.join('; ') || 'none'}`)
  const parts = partPairs.map(([c, host]) => `${c.name} in ${host.name}`)

  const curated = unitsOf(sources, year)
  const taken = new Set()
  const units = new Map()
  const overlapKm2 = (c, u) => {
    if (!boxesMeet(u.bounds, c.bounds)) return 0
    const shared = safely(() => clipper.intersection(c.polygons, u.polygons))
    return shared.error ? 0 : areaKm2(shared)
  }
  // By name first — Manchukuo is "Manchukuo (Japan)", the Empire of Japan "Empire of Japan" —
  // so a large country cannot take a smaller one's name by overlapping its curated outline.
  const byName = new Map()
  for (const c of kept) {
    const wanted = OHM_ALIASES[c.name] ?? OHM_RENAME[c.name] ?? c.name
    const u = curated.find((u) => !taken.has(u.id) && nameKey(u.name) === nameKey(wanted) && overlapKm2(c, u) > 0)
    if (u) {
      byName.set(c, u)
      taken.add(u.id)
    }
  }
  for (const c of kept) {
    let best = byName.get(c) ?? null
    let named = !!best
    // A name chosen here is not taken from whatever the country overlaps.
    if (!best && !(c.name in OHM_RENAME)) {
      let bestKm2 = 0
      for (const u of curated) {
        if (taken.has(u.id)) continue
        const km2 = overlapKm2(c, u)
        if (km2 > bestKm2) {
          best = u
          bestKm2 = km2
        }
      }
      named = !!best && bestKm2 >= NAMED_FROM * c.area
      if (named) taken.add(best.id)
    }
    const name = OHM_FIXED_NAMES[c.name] ?? (named ? best.name : (OHM_RENAME[c.name] ?? c.name))
    const chosen = !named && c.name in OHM_RENAME
    if (process.env.HIST_DEBUG) console.log(`[name] ${c.name} -> ${name} (${byName.has(c) ? "by name" : named ? "by overlap" : "own"})`)
    const id = slug(name)
    const known = units.get(id)
    if (known) known.polygons.push(...c.polygons)
    else units.set(id, { id, name, subject: named ? best.subject : null, polygons: [...c.polygons], ohm: c.name, own: !named && !chosen })
    c.unitId = id
  }

  /*
   * Where OpenHistoricalMap leaves land to no one — its 1914 Italian Somaliland is the coast
   * alone — the curated unit there fills it, under its own name (merged into the same unit where
   * OpenHistoricalMap has it too). Only real land: a thin seam along a border is left to the
   * neighbour beside it, as any leftover is.
   */
  const covered = safely(() => clipper.union(...kept.map((c) => c.polygons)))
  const filled = []
  if (!covered.error) {
    for (const u of curated) {
      const rest = safely(() => clipper.difference(u.polygons, covered))
      if (rest.error) continue
      const land = rest.filter((p) => {
        const area = polygonAreaKm2(p)
        const perimeter = ringLengthKm(p[0])
        return area >= FILL_MIN_KM2 && (perimeter > 0 ? (2 * area) / perimeter : 0) >= FILL_MIN_WIDTH_KM
      })
      if (land.length === 0) continue
      const known = units.get(u.id)
      if (known) known.polygons.push(...land)
      else units.set(u.id, { id: u.id, name: u.name, subject: u.subject, polygons: land, ohm: null })
      filled.push(`${u.name} ${Math.round(areaKm2(land))} km²`)
    }
  }
  log(`${year}: filled from historical-basemaps where OpenHistoricalMap has no one: ${filled.join('; ') || 'nothing'}`)
  log(`${year}: ${countries.length} OpenHistoricalMap countries on ${OHM_DATES[year]}, ${units.size} units; drawn inside another: ${parts.join('; ') || 'none'}`)
  const wins = new Set(partPairs.filter(([c, host]) => kept.includes(host) && kept.includes(c)).map(([c, host]) => `${c.unitId}>${host.unitId}`).filter((k) => k.split('>')[0] !== k.split('>')[1]))
  for (const [winner, losers] of Object.entries(OHM_PREFER)) {
    for (const w of kept.filter((c) => c.name === winner)) for (const l of kept.filter((c) => losers.includes(c.name))) wins.add(`${w.unitId}>${l.unitId}`)
  }
  const list = [...units.values()].map((u) => ({ ...u, bounds: boundsOf(u.polygons), areaKm2: areaKm2(u.polygons) }))
  return { units: list, beats: (a, b) => wins.has(`${a}>${b}`), curated }
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
        // Every region a member is in: the Soviet Union is on a map of Asia as well as Europe.
        regions: [...new Set(union.members.flatMap((id) => presetsOf(modernMeta[id])))],
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
  writeFileSync(resolve(outDir, `world-${year}${SUFFIX}.json`), JSON.stringify(topology))
  writeFileSync(
    resolve(outDir, `world-${year}${SUFFIX}-meta.json`),
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
  // OpenHistoricalMap's borders; historical-basemaps only names them (`ohmUnitsOf`).
  const { units, beats, curated } = await ohmUnitsOf(year, sources)
  clipper.created.length = 0
  reports.push(write(year, buildYear(year, sources, units, false, beats, curated)))
}
reports.push(write(1990, build1990()))
writeFileSync(resolve(outDir, `report${SUFFIX}.json`), JSON.stringify(reports, null, 1))
log('done ->', outDir)
