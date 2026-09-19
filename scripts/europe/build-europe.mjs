/**
 * Builds the two Europe maps from EuroGlobalMap.
 *
 *   node --max-old-space-size=14000 scripts/europe/build-europe.mjs [--refresh]
 *
 * A maintenance script like `build-usa.mjs`: it reads EuroGlobalMap from the GeoPackage
 * EuroGeographics delivers (see `egm.mjs` for where to put it) and writes the maps into
 * `data/europe/`, which is committed; ordinary builds only copy it. `--refresh` rebuilds the
 * reconciled areas (`atoms.mjs`) instead of reusing `.cache/egm/atoms.json`.
 *
 * ## Europe Countries
 *
 * Every country and territory EuroGlobalMap covers in Europe, drawn from its 1:1,000,000
 * administrative areas joined by country: coastlines, islands, enclaves and exclaves as the
 * national mapping agencies record them, with borders shared exactly (see `resolve.mjs`).
 * Areas EuroGlobalMap marks as in dispute between two countries are their own entities, so
 * neither country is shown holding them. The land around Europe comes from the World map's
 * Natural Earth countries and meets EuroGlobalMap's borders exactly (`context.mjs`); Russia
 * is EuroGlobalMap's to 51°E and Natural Earth's beyond, joined into one country.
 *
 * Three levels of geometric detail, one topology each (Map Detail): the full 1:1,000,000
 * geometry, and two generalised from it arc by arc (`simplify.mjs`), so borders stay shared.
 *
 * ## Europe Administrative
 *
 * The same areas, grouped at the level each country is actually administered by
 * (`levels.mjs`), in three presets: Regions, Standard and Detailed. Every unit knows its
 * country (`parent`), its designation (`kind`, from EuroBoundaryMap's designations) and the
 * coarser units of its country that hold it (`groups`).
 *
 * ## Ids
 *
 *   countries   ISO 3166-1 alpha-3, the World map's own (`FRA`, `XKX`)
 *   disputes    `eu-dispute-HR-SI`
 *   units       `eu-ebm-<SHN>`   EuroBoundaryMap's hierarchical number (stable across releases)
 *               `eu-nuts-<code>` Eurostat NUTS 3 code
 *               `eu-ne-<code>`   Natural Earth adm1_code
 *
 * ## Sources
 *
 *   - EuroGlobalMap 2026, © EuroGeographics, under the EuroGeographics Open Data Licence
 *     (commercial use permitted, with attribution). Owned by the national mapping and
 *     cadastral agencies listed at https://www.mapsforeurope.org/attributions.
 *   - Natural Earth (public domain): the countries around Europe, Russia east of 51°E, and
 *     admin-1 units for the countries EuroGlobalMap describes only as a whole.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as topojsonServer from 'topojson-server'
import { feature } from 'topojson-client'
import { geoContains } from 'd3-geo'
import * as clip from '../admin/clip.mjs'
import {
  areaKm2,
  boundsOf,
  boxesMeet,
  despiked,
  dissolve,
  interiorPoint,
  node,
  oriented,
  polygonsOf,
  split,
  uniquePolygons,
} from '../admin/geometry.mjs'
import { buildCountryTable } from '../country-table.mjs'
import { loadAtoms, pointIndex } from './atoms.mjs'
import { fitNeighbours } from './context.mjs'
import { openEgm, present, rows } from './egm.mjs'
import { COUNTRIES, PRESETS, PRESET_INFO, WATER_DESIGNATIONS, levelOf } from './levels.mjs'
import { cleanTopology, pointCount, simplifyTopology } from './simplify.mjs'
import { unpinched } from './unpinch.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = resolve(root, 'data/europe')
const REFRESH = process.argv.includes('--refresh')
const QUANTIZATION = 5e6
const log = (m) => console.log(`[europe] ${m}`)
const generatedAt = new Date().toISOString()
const report = { generatedAt, problems: [] }
const problem = (m) => {
  report.problems.push(m)
  log(`PROBLEM ${m}`)
}

/* ------------------------------------------------------------------ inputs */

const { atoms, report: atomReport } = loadAtoms(root, { refresh: REFRESH, log: console.log })
report.atoms = { count: atoms.length, ...atomReport }

/** Every ring simple: pinched rings make a merge take a chord (see `unpinch.mjs`). */
const pinchReport = {}
const simple = (polygons, stage) => {
  const { polygons: out, split } = unpinched(polygons)
  if (split) pinchReport[stage] = (pinchReport[stage] ?? 0) + split
  return out
}
report.pinched = pinchReport
for (const a of atoms) a.polygons = simple(a.polygons, 'atoms').map(oriented)

/**
 * Areas joined into one: a country from its areas, a Land from its Kreise.
 *
 * A TopoJSON merge, which removes exactly the borders the areas share. Every ring is first
 * made simple (`unpinch.mjs`) and wound one way (d3's): the merge tells an outer ring from a
 * hole by its winding, and EuroGlobalMap's rings and Clipper's are wound opposite ways, so a
 * merge of the two as delivered took whole outer rings for holes — Bulgaria came out at
 * 42,618 km² of its 110,806. Wound alike, every country's area is exactly the sum of its areas'.
 * (Clipper's union gives the same result but took 340 s for Austria alone.)
 */
/**
 * A unit cut from another layer (Natural Earth, NUTS 3) made one clean outline: its pieces and
 * the strips joined to them unioned with themselves, and zero-width retraces removed. Without
 * it, Krasnoyarsk Krai overlapped itself for 860 km along the Taymyr coast.
 */
const tidy = (polygons) => simple(despiked(clip.union(polygons)).map(oriented), 'tidy')

const join = (sets, stage) => {
  const parts = sets.map((p) => simple(p, stage).map(oriented)).filter((p) => p.length)
  if (parts.length === 0) return []
  return simple(dissolve(parts), stage)
}

const { db } = openEgm(root)

/** EuroBoundaryMap's names and designations, by hierarchical number. */
const NAMES = new Map()
{
  const designation = new Map()
  for (const t of ['EBM_ISN', 'EBM_ISN_optionKS', 'EBM_ISN_optionRS'])
    for (const r of db.prepare(`select ICC, ISN, DESN, DESA from "${t}"`).iterate()) designation.set(`${r.ICC}:${r.ISN}`, r.DESN || r.DESA)
  // Main first; the Kosovo and Serbia option tables fill in their own units.
  for (const t of ['EBM_NAM', 'EBM_NAM_optionKS', 'EBM_NAM_optionRS'])
    for (const r of db.prepare(`select ICC, SHN, USE, ISN, NAMN, NAMA from "${t}"`).iterate()) {
      if (NAMES.has(r.SHN)) continue
      const all = String(r.NAMN || r.NAMA || '').split('#').map((s) => s.trim()).filter((s) => s && s !== 'UNK')
      NAMES.set(r.SHN, {
        name: all[0] ?? r.SHN,
        official: all.join(' / '),
        kind: String(designation.get(`${r.ICC}:${r.ISN}`) ?? '').split('#')[0] || null,
        use: r.USE,
      })
    }
}

/** The World map's country table: names, ISO codes, regions, for every country id. */
const world = buildCountryTable().byId
const countryEntry = (iso3) => world[iso3] ?? null

/* ---------------------------------------------------------- atoms by country */

const isoOf = (icc) => COUNTRIES[icc]?.iso3 ?? null
const disputeId = (icc) => `eu-dispute-${icc.replace('#', '-')}`
const disputeName = (icc) => {
  const [a, b] = icc.split('#').map((c) => countryEntry(isoOf(c))?.name ?? c)
  return `${a}–${b} disputed area`
}

/** Whether an atom is water: a lake EuroBoundaryMap keeps as a unit of its own, outside every municipality. */
const hasLevels = new Set(atoms.filter((a) => a.kind === 'area' && a.shn.slice(1).some(Boolean)).map((a) => a.icc))
const isWaterAtom = (a) => {
  if (a.kind !== 'area') return false
  const deepest = [...a.shn].reverse().find(Boolean)
  if (deepest && WATER_DESIGNATIONS.has(NAMES.get(deepest)?.kind)) return true
  return hasLevels.has(a.icc) && !a.shn.slice(1).some(Boolean)
}
report.waterAtoms = atoms.filter(isWaterAtom).map((a) => ({ icc: a.icc, km2: Number(areaKm2(a.polygons).toFixed(1)) }))

for (const a of atoms) if (a.kind === 'area' && !isoOf(a.icc)) problem(`no country for EuroGlobalMap code ${a.icc}`)

/* ------------------------------------------------------------- countries */

const egmCountries = new Map() // id -> { id, polygons, icc[] }
for (const a of atoms) {
  const id = a.kind === 'dispute' ? disputeId(a.icc) : isoOf(a.icc)
  if (!id) continue
  const c = egmCountries.get(id) ?? { id, parts: [], iccs: new Set() }
  c.parts.push(a.polygons)
  c.iccs.add(a.icc)
  egmCountries.set(id, c)
}
for (const c of egmCountries.values()) {
  const t = Date.now()
  c.polygons = join(c.parts, 'countries')
  delete c.parts
  if (Date.now() - t > 3000) log(`joined ${c.id} in ${((Date.now() - t) / 1000).toFixed(0)} s`)
}
log(`${egmCountries.size} countries and disputed areas from EuroGlobalMap`)

/* --------------------------------------------------- Russia and the neighbours */

const ne = JSON.parse(readFileSync(resolve(root, 'data/natural-earth/countries-10m.json'), 'utf8'))
const neFeatures = feature(ne, ne.objects.countries).features
const neById = new Map(neFeatures.map((f) => [f.id, f]))

/** Everything EuroGlobalMap's countries cover, for the neighbours to stop at. */
const europeList = [...egmCountries.values()].map((c) => ({ id: c.id, polygons: c.polygons }))

// Russia: EuroGlobalMap's to 51°E, Natural Earth's beyond, joined.
{
  const rus = egmCountries.get('RUS')
  const neRus = polygonsOf(neById.get('RUS').geometry)
  const east = [
    ...clip.intersection(neRus, [[[[50.9, -90], [180, -90], [180, 90], [50.9, 90], [50.9, -90]]]]),
    ...neRus.filter((p) => boundsOf([p])[2] < -150),
  ]
  const near = europeList.filter((c) => c.id !== 'RUS').filter((c) => boxesMeet(boundsOf(c.polygons), [40, 35, 60, 80])).flatMap((c) => c.polygons)
  const rest = clip.difference(east, [...rus.polygons, ...near])
  // Joined like every country: noded, so the seam at 51°E is one line on both sides, then merged.
  const halves = [{ polygons: rus.polygons }, { polygons: rest }]
  node(halves, clip.created)
  rus.polygons = join(halves.map((h) => h.polygons), 'russia')
  report.russia = { eastOf51Km2: Math.round(areaKm2(rest)) }
  log(`Russia joined: ${report.russia.eastOf51Km2.toLocaleString()} km² east of 51°E from Natural Earth`)
}

// The neighbours: Natural Earth countries near Europe that EuroGlobalMap does not hold.
const COVERED = new Set([...egmCountries.keys(), 'XNC', 'XAK', 'XDH', 'XCB', 'UNK', 'SJM', 'ATA', 'CYN'])
// North Africa to Kazakhstan: the land a map framed on Europe shows, and no further east than Iran.
const WINDOW = [-32, 17, 60, 84]
const neighbours = neFeatures
  .filter((f) => !COVERED.has(f.id) && f.geometry)
  .filter((f) => boxesMeet(boundsOf(polygonsOf(f.geometry)), WINDOW))
  .map((f) => ({ id: f.id, polygons: uniquePolygons(polygonsOf(f.geometry)) }))
  // Large first, so a big neighbour keeps any ground two of them contest.
  .sort((a, b) => areaKm2(b.polygons) - areaKm2(a.polygons))
const neLand = neFeatures.filter((f) => f.geometry).map((f) => ({ id: f.id, polygons: polygonsOf(f.geometry) }))
const { placed: context, report: contextReport } = fitNeighbours(neighbours, neLand, europeList.map((c) => (c.id === 'RUS' ? { ...c, polygons: egmCountries.get('RUS').polygons } : c)))
report.context = contextReport
log(`${context.length} neighbouring countries around Europe`)

/* ----------------------------------------------------------------- writing */

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const written = {}
const write = (name, value) => {
  const text = JSON.stringify(value)
  writeFileSync(resolve(outDir, name), text)
  written[name] = `${(text.length / 1e6).toFixed(2)} MB`
}

/** One topology per detail level, from one set of noded units. */
function topologyOf(units) {
  for (const u of units) u.polygons = simple(u.polygons, 'final')
  return topojsonServer.topology(
    {
      units: {
        type: 'FeatureCollection',
        features: units.map((u) => ({ type: 'Feature', id: u.id, geometry: { type: 'MultiPolygon', coordinates: u.polygons.map(oriented) } })),
      },
    },
    QUANTIZATION,
  )
}

/**
 * Arcs one unit alone uses that have land on both sides: gaps between neighbours. Asked of the
 * topology as it is written, decoded exactly as the editor decodes it, so what is checked is
 * what ships.
 */
function interiorGaps(topology) {
  const uses = new Map()
  const owner = new Map()
  for (const g of topology.objects.units.geometries) {
    const walk = (a) => {
      if (typeof a !== 'number') return a.forEach(walk)
      const k = a < 0 ? ~a : a
      uses.set(k, (uses.get(k) ?? 0) + 1)
      owner.set(k, g.id)
    }
    walk(g.arcs ?? [])
  }
  const shipped = feature(topology, topology.objects.units).features
  const covered = pointIndex(shipped.flatMap((f) => (f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.coordinates ?? [])), 0.5)
  const byPair = {}
  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  let gaps = 0
  let gapKm = 0
  const samples = []
  for (const [a, n] of uses) {
    if (n !== 1) continue
    let x = 0
    let y = 0
    const pts = topology.arcs[a].map(([dx, dy]) => [tx + (x += dx) * sx, ty + (y += dy) * sy])
    if (pts.length < 2) continue
    // The antimeridian, where Natural Earth cuts Chukotka in two: the map's edge, not a border.
    if (pts.every((p) => Math.abs(p[0]) > 179.99)) continue
    const i = Math.max(1, Math.floor(pts.length / 2))
    const [p0, p1] = [pts[i - 1], pts[i]]
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if (len === 0) continue
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
    const off = [(-(p1[1] - p0[1]) / len) * 1e-4, ((p1[0] - p0[0]) / len) * 1e-4]
    if (covered([mid[0] + off[0], mid[1] + off[1]]) && covered([mid[0] - off[0], mid[1] - off[1]])) {
      gaps++
      let km = 0
      for (let k = 1; k < pts.length; k++) km += Math.hypot((pts[k][0] - pts[k - 1][0]) * Math.cos((pts[k][1] * Math.PI) / 180), pts[k][1] - pts[k - 1][1]) * 111.195
      gapKm += km
      if (samples.length < 10) samples.push(mid.map((v) => Number(v.toFixed(4))))
      const who = String(owner.get(a)).replace(/^eu-(ebm|ne|nuts)-/, '').slice(0, 2)
      const entry = (byPair[who] ??= { arcs: 0, km: 0, at: mid.map((v) => Number(v.toFixed(3))) })
      entry.arcs++
      entry.km = Number((entry.km + km).toFixed(2))
    }
  }
  return { arcs: gaps, km: Number(gapKm.toFixed(2)), samples, byOwner: byPair }
}

/* ------------------------------------------------------- Europe Countries */

const DETAIL = {
  full: { label: 'Full Detail (1:1M)', tolerance: 0 },
  standard: { label: 'Standard', tolerance: 120 },
  light: { label: 'Light', tolerance: 600 },
}

const countryUnits = [
  ...[...egmCountries.values()].map((c) => ({ id: c.id, polygons: c.polygons })),
  ...context.filter((c) => c.polygons.length > 0).map((c) => ({ id: c.id, polygons: c.polygons })),
]

report.countries = { units: countryUnits.length, noded: node(countryUnits, clip.created) }
{
  const base = topologyOf(countryUnits)
  report.countries.clean = cleanTopology(base)
  report.countries.gaps = interiorGaps(base)
  if (report.countries.gaps.arcs) problem(`countries: ${report.countries.gaps.arcs} unshared borders inside the land (${report.countries.gaps.km} km)`)
  report.countries.detail = {}
  for (const [level, { tolerance }] of Object.entries(DETAIL)) {
    const t = simplifyTopology(base, tolerance)
    if (tolerance) report.countries[`clean-${level}`] = cleanTopology(t)
    write(`countries-${level}.json`, t)
    report.countries.detail[level] = { points: pointCount(t), size: written[`countries-${level}.json`] }
    log(`countries ${level}: ${pointCount(t).toLocaleString()} points, ${written[`countries-${level}.json`]}`)
  }
}

/** A country's entry in the entity table: the World map's own, so names and flags agree. */
function countryMetaEntry(id, polygons) {
  const point = interiorPoint(polygons) ?? [0, 0]
  const base = countryEntry(id)
  if (base) return { ...base, id, lat: Number(point[1].toFixed(4)), lng: Number(point[0].toFixed(4)) }
  const icc = id.slice('eu-dispute-'.length).replace('-', '#')
  return {
    id,
    iso2: null,
    code: icc.replace('#', '–'),
    numeric: null,
    name: disputeName(icc),
    officialName: `${disputeName(icc)} (area in dispute, EuroGlobalMap)`,
    region: 'Europe',
    subregion: countryEntry(isoOf(icc.split('#')[0]))?.subregion ?? 'Europe',
    independent: false,
    kind: 'Disputed area',
    lat: Number(point[1].toFixed(4)),
    lng: Number(point[0].toFixed(4)),
  }
}

{
  const entities = {}
  for (const u of countryUnits) entities[u.id] = countryMetaEntry(u.id, u.polygons)
  write('countries-meta.json', { generatedAt, numericToId: {}, nameToId: {}, entities })
}

/* -------------------------------------------------- Europe Administrative */

const ne1 = JSON.parse(readFileSync(resolve(root, '.cache/ne-admin1/admin1.geojson'), 'utf8')).features
const nuts3 = [...rows(db, 'NUTS3', 'TAA = 2')]

/** The code an atom is drawn with at hierarchy level n: its own, else coarser, else finer. */
function codeAt(atom, n) {
  if (atom.shn[n]) return atom.shn[n]
  for (let k = n - 1; k >= 1; k--) if (atom.shn[k]) return atom.shn[k]
  for (let k = n + 1; k <= 4; k++) if (atom.shn[k]) return atom.shn[k]
  return atom.shn[0]
}

/** The coarser units of its own country that hold a unit: its Land, its Regierungsbezirk. */
function groupsOf(atom, n) {
  const out = []
  for (let k = 1; k < n; k++) {
    const code = atom.shn[k]
    if (!code) continue
    const info = NAMES.get(code)
    out.push({ scheme: info?.kind ?? `Level ${k}`, id: `eu-ebm-${code}`, name: info?.name ?? code, level: `ebm-${k}` })
  }
  return out
}

const parentOf = (iso3) => {
  const c = countryEntry(iso3)
  return { id: iso3, name: c?.name ?? iso3, iso2: c?.iso2 ?? null, kind: 'Country', code: c?.iso2 ?? iso3, region: c?.region ?? 'Europe', subregion: c?.subregion ?? 'Europe' }
}

const EGM_CREDIT = 'EuroGlobalMap 2026, © EuroGeographics (EuroBoundaryMap hierarchy)'

function adminUnits(preset) {
  const units = []
  const byCountry = new Map()
  for (const a of atoms) {
    if (a.kind !== 'area') continue
    const list = byCountry.get(a.icc) ?? []
    list.push(a)
    byCountry.set(a.icc, list)
  }
  for (const [icc, list] of byCountry) {
    const iso3 = isoOf(icc)
    if (!iso3) continue
    const level = levelOf(icc, preset)
    const land = list.filter((a) => !isWaterAtom(a))
    const parent = parentOf(iso3)
    if (level.whole) {
      const shn0 = land[0]?.shn[0] ?? icc
      units.push({
        id: `eu-ebm-${shn0}`,
        polygons: join(land.map((a) => a.polygons), 'admin'),
        core: { name: parent.name, officialName: NAMES.get(shn0)?.official || parent.name, kind: 'Country', code: parent.code, parent, level: 'Country', source: { dataset: EGM_CREDIT, ids: [shn0] } },
      })
      continue
    }
    if (level.shn) {
      const groups = new Map()
      for (const a of land) {
        const code = codeAt(a, level.shn)
        const g = groups.get(code) ?? { code, atoms: [] }
        g.atoms.push(a)
        groups.set(code, g)
      }
      for (const g of groups.values()) {
        const info = NAMES.get(g.code)
        if (!info) problem(`${icc}: no name for ${g.code}`)
        units.push({
          id: `eu-ebm-${g.code}`,
          polygons: join(g.atoms.map((a) => a.polygons), 'admin'),
          core: {
            name: info?.name ?? g.code,
            officialName: info?.official || info?.name || g.code,
            kind: info?.kind ?? null,
            code: g.code,
            parent,
            groups: groupsOf(g.atoms[0], Math.min(level.shn, info?.use ? info.use - 1 : level.shn)),
            source: { dataset: EGM_CREDIT, ids: [g.code] },
          },
        })
      }
      continue
    }
    // NUTS 3 or Natural Earth: the country's own land, cut or grouped by the other layer.
    const outline = iso3 === 'RUS' ? egmCountries.get('RUS').polygons : join(land.map((a) => a.polygons), 'admin')
    if (level.nuts3) {
      const regions = nuts3.filter((r) => r.ICC === icc)
      // Where every area lies within one region (Slovenia's municipalities), group; else cut.
      const index = regions.map((r) => ({ r, entry: pointIndex(r.polygons, 0.25) }))
      const byRegion = new Map()
      let groupable = true
      for (const a of land) {
        const p = interiorPoint(a.polygons)
        const hit = index.find(({ entry }) => p && entry(p))
        if (!hit) {
          groupable = false
          break
        }
        const list2 = byRegion.get(hit.r.NUTS_CODE) ?? { r: hit.r, atoms: [] }
        list2.atoms.push(a)
        byRegion.set(hit.r.NUTS_CODE, list2)
      }
      const nutsUnit = (code, label, polygons) => ({
        id: `eu-nuts-${code}`,
        polygons,
        core: { name: label, officialName: label, kind: 'NUTS 3 region', code, parent, source: { dataset: `${EGM_CREDIT}, NUTS 3 layer (Eurostat NUTS 2024)`, ids: [code] } },
      })
      // Group only where the areas are finer than the regions: every region then holds one
      // (Slovenia's 212 municipalities in 12 regions). Greece's 13 regions each hold several.
      if (groupable && byRegion.size === new Set(regions.map((r) => r.NUTS_CODE)).size) {
        for (const [code, g] of byRegion) units.push(nutsUnit(code, g.r.NUTS_LABEL, join(g.atoms.map((a) => a.polygons), 'admin')))
      } else {
        const merged = new Map()
        for (const r of regions) {
          const m = merged.get(r.NUTS_CODE) ?? { key: r.NUTS_CODE, label: r.NUTS_LABEL, polygons: [] }
          m.polygons.push(...r.polygons)
          merged.set(r.NUTS_CODE, m)
        }
        const { pieces, report: sr } = split([{ id: iso3, polygons: outline }], [...merged.values()])
        report[`split-${preset}-${icc}`] = { unassigned: sr.unassignedSources.length, reconciledKm2: sr.reconciledKm2, failures: sr.clipFailures.length }
        for (const piece of pieces) if (piece.source) units.push(nutsUnit(piece.source.key, piece.source.label, tidy(piece.polygons)))
      }
      continue
    }
    if (level.ne) {
      const sources = ne1
        .filter((f) => f.properties.adm0_a3 === iso3 && f.geometry)
        .map((f) => ({ key: f.properties.adm1_code, props: f.properties, polygons: uniquePolygons(polygonsOf(f.geometry)) }))
      const { pieces, report: sr } = split([{ id: iso3, polygons: outline }], sources)
      report[`split-${preset}-${icc}`] = { sources: sources.length, unassigned: sr.unassignedSources.length, reconciledKm2: sr.reconciledKm2, failures: sr.clipFailures.length }
      for (const piece of pieces) {
        if (!piece.source) continue
        const p = piece.source.props
        units.push({
          id: `eu-ne-${p.adm1_code}`,
          polygons: tidy(piece.polygons),
          core: {
            name: p.name_en || p.name,
            officialName: p.name,
            kind: p.type_en ?? null,
            code: p.iso_3166_2 && !p.iso_3166_2.includes('~') ? p.iso_3166_2 : p.adm1_code,
            parent,
            source: { dataset: `Natural Earth 10m admin-1 (public domain), cut into ${EGM_CREDIT}'s outline`, ids: [p.adm1_code], iso31662: p.iso_3166_2 ?? null },
          },
        })
      }
    }
  }
  // Disputed areas and the neighbours around Europe, as they are on Europe Countries.
  for (const [id, c] of egmCountries) {
    if (!id.startsWith('eu-dispute-')) continue
    units.push({ id, polygons: c.polygons, core: { ...countryMetaEntry(id, c.polygons), dispute: true } })
  }
  for (const c of context) if (c.polygons.length) units.push({ id: c.id, polygons: c.polygons, core: { ...countryMetaEntry(c.id, c.polygons), context: true } })
  return units
}

const ADMIN_TOLERANCE = 60
report.admin = {}
for (const preset of PRESETS) {
  const units = adminUnits(preset)
  const ids = new Set()
  for (const u of units) {
    if (ids.has(u.id)) problem(`${preset}: duplicate id ${u.id}`)
    ids.add(u.id)
  }
  const noded = node(units, clip.created)
  const base = topologyOf(units)
  const cleanBase = cleanTopology(base)
  const t = simplifyTopology(base, ADMIN_TOLERANCE)
  const clean = cleanTopology(t)
  const gaps = interiorGaps(t)
  write(`admin-${preset}.json`, t)

  // The entity table, compact: every unit names its country, which is written once.
  const parents = {}
  const groupTable = {}
  const entities = {}
  for (const u of units) {
    const point = interiorPoint(u.polygons) ?? [0, 0]
    const where = { lat: Number(point[1].toFixed(4)), lng: Number(point[0].toFixed(4)) }
    if (!u.core.parent) {
      // A country: a disputed area, or a neighbour around Europe.
      const { dispute, context: ctx, ...entry } = u.core
      entities[u.id] = { ...entry, ...where, level: { id: 'country', name: 'Countries' } }
      continue
    }
    const { parent, groups = [], officialName, source, ...rest } = u.core
    if (!parents[parent.id]) parents[parent.id] = parent
    const entry = { ...rest, parent: parent.id, ...where, source: { iso31662: null, hasc: null, wikidata: null, ...source } }
    if (officialName && officialName !== rest.name) entry.officialName = officialName
    if (groups.length) entry.groups = groups.map((g) => ((groupTable[g.id] = g), g.id))
    entities[u.id] = entry
  }
  write(`admin-${preset}-meta.json`, {
    generatedAt,
    numericToId: {},
    nameToId: {},
    defaults: { iso2: null, numeric: null, independent: false, level: { id: preset, name: PRESET_INFO[preset].label } },
    parents,
    groups: groupTable,
    entities,
  })
  report.admin[preset] = { units: units.length, noded, clean: { base: cleanBase, simplified: clean }, gaps, points: pointCount(t), size: written[`admin-${preset}.json`] }
  if (gaps.arcs) problem(`admin ${preset}: ${gaps.arcs} unshared borders inside the land (${gaps.km} km)`)
  log(`admin ${preset}: ${units.length} units, ${pointCount(t).toLocaleString()} points, ${written[`admin-${preset}.json`]}`)
}

/* ------------------------------------------------------------------ water */

/** A lake ring generalised (Douglas–Peucker, about 60 m) and rounded to 1e-5° (about 1 m). */
function lakeRing(ring, tolerance = 60 / 111195) {
  const n = ring.length
  if (n <= 5) return ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))])
  const cos = Math.cos((ring[0][1] * Math.PI) / 180)
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = ring[a]
    const [bx, by] = ring[b]
    const vx = (bx - ax) * cos
    const vy = by - ay
    const l2 = vx * vx + vy * vy
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const px = (ring[i][0] - ax) * cos
      const py = ring[i][1] - ay
      const t = l2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / l2)) : 0
      const d = Math.hypot(px - t * vx, py - t * vy)
      if (d > worst) (worst = d), (at = i)
    }
    if (at > 0 && worst > tolerance) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  let out = ring.filter((_, i) => keep[i])
  // A closed ring needs three corners besides the repeated first point.
  if (out.length < 4) out = [ring[0], ring[Math.floor(n / 3)], ring[Math.floor((2 * n) / 3)], ring[0]]
  return out.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))])
}

{
  // EuroGlobalMap's lakes and reservoirs, the larger ones: about 3 km² and up.
  const lakes = []
  for (const r of rows(db, 'LakeresA', 'Shape_Area > 0.0004')) {
    const km2 = areaKm2(r.polygons)
    if (km2 < 3) continue
    const name = [r.NAMN1, r.NAMA1].find((n) => present(n)) ?? null
    // Generalised to about 60 m, well under what any zoom shows: the full 1:1M outlines of 4,800
    // lakes weighed 20 MB. A ring keeps at least four points, so no lake loses its shape.
    const coordinates = r.polygons
      .map((p) => p.map((ring) => lakeRing(ring)).filter((ring) => ring.length >= 4))
      .filter((p) => p.length > 0)
    if (coordinates.length === 0) continue
    lakes.push({ km2, feature: { type: 'Feature', properties: { name, scalerank: km2 >= 1000 ? 0 : km2 >= 100 ? 2 : km2 >= 20 ? 4 : 6 }, geometry: { type: 'MultiPolygon', coordinates } } })
  }
  lakes.sort((a, b) => b.km2 - a.km2)
  write('lakes.geojson', { type: 'FeatureCollection', features: lakes.map((l) => l.feature) })
  report.lakes = lakes.length
  log(`${lakes.length} lakes`)
}

/* ---------------------------------------------------------------- credits */

write('sources.json', {
  generatedAt,
  sources: [
    {
      name: 'EuroGlobalMap 2026',
      agency: 'EuroGeographics and the national mapping and cadastral agencies of Europe',
      licence: 'EuroGeographics Open Data Licence (commercial use permitted with attribution)',
      attribution: '© EuroGeographics. EuroGlobalMap is owned by the national mapping and cadastral agencies listed at https://www.mapsforeurope.org/attributions',
      url: 'https://www.mapsforeurope.org',
      scale: '1:1,000,000',
    },
    { name: 'Natural Earth', agency: 'Natural Earth', licence: 'Public domain', url: 'https://www.naturalearthdata.com' },
  ],
})

report.outputs = written
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 1))
log(`wrote ${Object.entries(written).map(([k, v]) => `${k} ${v}`).join(', ')}`)
if (report.problems.length) log(`${report.problems.length} problems`)
