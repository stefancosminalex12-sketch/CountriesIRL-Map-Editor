/**
 * Builds the Modern Administrative World from the curated country table.
 *
 * Called by `build-geography.mjs` with Natural Earth's admin-1 units — minor islands already
 * joined to the unit they lie beside — and runnable on its own from the copy of those units
 * that script leaves in `.cache/`, so the table can be iterated on without rebuilding the
 * rest of the geography:
 *
 *   node --max-old-space-size=8192 scripts/admin/build-admin.mjs [--refresh]
 *
 * ## What it writes (`data/admin/`, copied to `public/geo/admin/` by prepare-data)
 *
 *   base.json              the curated map: one TopoJSON topology, one arc per border
 *   base-meta.json         its entity table
 *   <ISO3>.<level>.json    a fragment: one country at another level — its units, their
 *                          entity rows, and the arcs they add to the base
 *   index.json             which fragments make up More Detailed and Maximum, per country
 *   report.json            the validation below, per country and level
 *
 * ## Why fragments
 *
 * The renderer draws one topology, and everything it knows about borders — which lines are
 * coast, which separate two countries, what merging removes — comes from arcs being shared.
 * So every level of every country is built into ONE topology here, with its arcs cut at the
 * junctions of all of them, and then split: the curated units' arcs go in the base, and each
 * other level carries only the arcs the base does not have. A fragment's outline is made of
 * base arcs, so replacing a country's units with a fragment's leaves its coast and its
 * borders with its neighbours exactly as they were. Only the countries a preset changes are
 * fetched, and the rest of the world is never loaded twice.
 *
 * ## What it checks (`report.json`)
 *
 *   - every Natural Earth polygon of a country, islands included, lies in exactly one unit
 *     at each level: no gaps, no overlaps, no lost islands;
 *   - ids are unique across all levels and every unit names its country;
 *   - every preset composes to Natural Earth's own coastline and international borders, arc for
 *     arc: a line a cut failed to share, drawn as coast where it is a border, is reported by
 *     kind, length and place;
 *   - how many units each level has and how large they are, so fragmentation shows.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as topojson from 'topojson-server'
import { COUNTRIES, NE_LEVEL_NAMES, POLICY } from './countries.mjs'
import { createSources, NATURAL_EARTH_CREDIT } from './sources.mjs'
import {
  areaKm2,
  contains,
  dissolve,
  indexed,
  interiorPoint,
  km,
  node,
  oriented,
  polygonAreaKm2,
  polygonsOf,
  split,
  uniquePolygons,
  polygonKey,
  despiked,
} from './geometry.mjs'
import { union as clipUnion, difference as clipDifference, created } from './clip.mjs'

export const PRESETS = ['curated', 'detailed', 'maximum']

/** The name of the piece a split's `join` leaves: the cut unit itself, less what was taken. */
const REMAINDER = '\u0000remainder'
const QUANTIZATION = 1e6

/*
 * `stopAt`: where a split's joined pieces end at water — see `endAtWater`.
 *
 * The water is Natural Earth's own, from the geography this build is part of: the lake polygon
 * the map draws, found by a point inside it, and a river's line, drawn as a strip a couple of
 * metres wide — a thin quad along each segment and a small octagon at each vertex, so no bend
 * leaves a gap — which parts the land on either side of the line.
 */
const RIVER_HALF_WIDTH = 1e-5
/** The Natural Earth geography this build is part of, found from this file rather than a caller's root. */
const NATURAL_EARTH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/natural-earth')
const waterCutters = new Map()

function waterCutter(stopAt) {
  const key = JSON.stringify(stopAt)
  if (waterCutters.has(key)) return waterCutters.get(key)
  const read = (name) => JSON.parse(readFileSync(resolve(NATURAL_EARTH, name), 'utf8'))
  const lake = read('lakes-10m.geojson').features.find((f) => contains(indexed(polygonsOf(f.geometry)), stopAt.lakeAt))
  if (!lake) throw new Error(`stopAt: no lake at ${stopAt.lakeAt.join(', ')}`)
  const lakePolygons = polygonsOf(lake.geometry)
  // The river near the lake: a degree round it reaches the oblast's stretch of it, not its source.
  const ring = lakePolygons.flat(2)
  const [w, e] = [Math.min(...ring.map((p) => p[0])) - 1, Math.max(...ring.map((p) => p[0])) + 1]
  const [s, n] = [Math.min(...ring.map((p) => p[1])) - 1, Math.max(...ring.map((p) => p[1])) + 1]
  const near = ([x, y]) => x >= w && x <= e && y >= s && y <= n
  const lines = read('rivers-10m.geojson')
    .features.filter((f) => f.properties.name === stopAt.river)
    .flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []))
  if (lines.length === 0) throw new Error(`stopAt: no river named ${stopAt.river}`)
  const r = RIVER_HALF_WIDTH
  const strip = []
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const [bx, by] = line[i]
      if (!near(line[i]) && !(i > 0 && near(line[i - 1]))) continue
      const octagon = []
      for (let k = 0; k <= 8; k++) octagon.push([bx + r * Math.cos((k * Math.PI) / 4), by + r * Math.sin((k * Math.PI) / 4)])
      strip.push([octagon])
      if (i === 0) continue
      const [ax, ay] = line[i - 1]
      const length = Math.hypot(bx - ax, by - ay)
      if (!length) continue
      const nx = (-(by - ay) / length) * r
      const ny = ((bx - ax) / length) * r
      strip.push([[[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny], [ax + nx, ay + ny]]])
    }
  }
  const cutter = clipUnion(lakePolygons, strip)
  if (cutter.error) throw new Error(`stopAt: could not join the lake and the river: ${cutter.error}`)
  const water = { cutter, strip }
  waterCutters.set(key, water)
  return water
}

/** Whether a polygon has a vertex on an edge of `polygons`, to a few centimetres. */
function touchesEdgesOf(polygons) {
  const CELL = 0.01
  const TOLERANCE = 2e-6
  const grid = new Map()
  const at = (x, y) => `${x},${y}`
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]
        const b = ring[i]
        for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++) {
          for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
            const cell = grid.get(at(x, y))
            if (cell) cell.push([a, b])
            else grid.set(at(x, y), [[a, b]])
          }
        }
      }
    }
  }
  const onEdge = ([px, py]) => {
    const cx = Math.floor(px / CELL)
    const cy = Math.floor(py / CELL)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [a, b] of grid.get(at(cx + dx, cy + dy)) ?? []) {
          const vx = b[0] - a[0]
          const vy = b[1] - a[1]
          const l2 = vx * vx + vy * vy
          const u = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2)) : 0
          if (Math.hypot(a[0] + u * vx - px, a[1] + u * vy - py) <= TOLERANCE) return true
        }
      }
    }
    return false
  }
  return (polygon) => polygon.some((ring) => ring.some(onEdge))
}

/**
 * A joined piece ended at water: the piece on the near side of a lake and a river, and none of
 * what they cut off.
 *
 * With the water taken out, what is left of the piece falls into parts. Its main body stays —
 * the largest part. A part the river touches is across the water from that body — the river runs
 * down the estuary and out through its mouth, so land beyond it, or between its channels, meets
 * it — and goes to the rest, with the water itself. Every other part stays: an island off the
 * piece's own coast, and a scrap of its own shore that an inlet of the lake pinches off, which
 * only the lake touches. (Touching the rest of the unit is no test: the split can leave scraps of
 * the estuary with the rest, right against the near shore.) Nothing is added to the piece: it can only end sooner, so no land changes hands but
 * land the water separates from it.
 */
function endAtWater(polygons, water) {
  const cut = clipDifference(polygons, water.cutter)
  if (cut.error || cut.length === 0) return null
  const parts = cut.map((p) => ({ p, area: polygonAreaKm2(p) })).sort((a, b) => b.area - a.area)
  const byRiver = touchesEdgesOf(water.strip)
  const kept = [parts[0].p]
  let movedKm2 = 0
  for (const { p, area } of parts.slice(1)) {
    if (byRiver(p)) movedKm2 += area
    else kept.push(p)
  }
  return { polygons: despiked(kept).map(oriented), keptKm2: areaKm2(kept), movedKm2 }
}

const known = (value) =>
  value !== null && value !== undefined && value !== '' && !String(value).includes('-99')

/** An id safe in any attribute or selector: Natural Earth's own are, bar a few (`PFA+00?`). */
const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_')

const FOLD = { đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', ı: 'i', ß: 'ss', œ: 'oe' }
export const slug = (value) =>
  String(value)
    .replace(/[đĐłŁøØæÆıßœ]/g, (c) => FOLD[c])
    .normalize('NFD')
    .split('')
    // Combining marks (U+0300-U+036F): what NFD leaves of an accent.
    .filter((c) => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
    .join('')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

/** The part of a code used in an id: `SI041` as it is, `IE-D` as its subdivision part `D`. */
const codeTag = (code) => {
  const text = String(code)
  if (/^[A-Z]{2}-[A-Z0-9]+$/.test(text)) return text.slice(3)
  return /^[A-Za-z0-9]+$/.test(text) ? text : slug(text)
}

/* ------------------------------------------------------------------ per country */

class Country {
  constructor(id, units, config, table, sources, credits, problems) {
    this.id = id
    this.units = units
    this.config = config
    this.meta = table.byId[id]
    this.name = this.meta?.name ?? units[0]?.props.admin ?? id
    this.sources = sources
    this.credits = credits
    this.problems = problems
    /** Things decided that are worth reading but are not faults. */
    this.notes = []
    this.levels = new Map()
    this.building = new Map()
  }

  problem(message) {
    this.problems.push(`${this.id}: ${message}`)
  }

  /** Natural Earth units named by adm1_code, then ISO 3166-2, then name. */
  match(keys) {
    const found = []
    for (const key of keys) {
      const byId = this.units.filter((u) => u.id === key)
      const byIso = byId.length ? byId : this.units.filter((u) => u.props.iso_3166_2 === key)
      const hits = byIso.length ? byIso : this.units.filter((u) => unitName(u).toLowerCase() === String(key).toLowerCase())
      if (hits.length === 0) this.problem(`no Natural Earth unit matches "${key}"`)
      found.push(...hits)
    }
    return found
  }

  describe(levelId) {
    if (levelId === 'ne') {
      return {
        id: 'ne',
        name: this.config.ne?.name ?? NE_LEVEL_NAMES[this.id]?.[0] ?? 'First-level subdivisions',
        kind: this.config.ne?.kind ?? NE_LEVEL_NAMES[this.id]?.[1] ?? null,
        adminLevel: 'ADM1',
        credits: ['naturalearth'],
      }
    }
    if (levelId === 'country') {
      return { id: 'country', name: 'Whole country', kind: this.meta?.independent ? 'Country' : 'Territory', adminLevel: 'ADM0', credits: ['naturalearth'] }
    }
    const spec = this.config.levels?.[levelId]
    if (!spec) throw new Error(`${this.id}: unknown level "${levelId}"`)
    return { id: levelId, name: spec.name, kind: spec.kind, adminLevel: spec.adminLevel ?? null, vintage: spec.vintage ?? null, note: spec.note ?? null, credits: [] }
  }

  async level(levelId) {
    if (this.levels.has(levelId)) return this.levels.get(levelId)
    if (this.building.has(levelId)) return this.building.get(levelId)
    const task = this.buildLevel(levelId).then((features) => {
      const level = { ...this.describe(levelId), features }
      level.credits = [...new Set([...(level.credits ?? []), ...features.flatMap((f) => f.credits)])]
      this.levels.set(levelId, level)
      return level
    })
    this.building.set(levelId, task)
    return task
  }

  async buildLevel(levelId) {
    if (levelId === 'ne') return this.units.map((u) => this.neFeature(u))
    if (levelId === 'country') {
      return [
        {
          id: `${this.id}-ALL`,
          name: this.name,
          localName: this.meta?.officialName ?? this.name,
          kind: this.meta?.independent ? 'Country' : 'Territory',
          code: this.meta?.iso2 ?? this.id,
          polygons: dissolve(this.units.map((u) => u.polygons)),
          members: this.units.map((u) => u.id),
          memberNames: this.units.map(unitName),
          credits: ['naturalearth'],
          source: { dataset: 'Natural Earth admin-1', ids: this.units.map((u) => u.id) },
        },
      ]
    }
    const spec = this.config.levels?.[levelId]
    if (!spec) throw new Error(`${this.id}: unknown level "${levelId}"`)
    if (spec.group) return this.buildGroup(levelId, spec)
    if (spec.split) return this.buildSplit(levelId, spec)
    throw new Error(`${this.id}.${levelId}: a level needs a group or a split recipe`)
  }

  neFeature(u) {
    const p = u.props
    const iso = known(p.iso_3166_2) ? p.iso_3166_2 : null
    // A unit's own entry, then the country's `'*'` — for a source that types a whole level wrongly.
    const kindOverride = this.config.kinds?.[u.id] ?? (iso ? this.config.kinds?.[iso] : undefined) ?? this.config.kinds?.['*']
    return {
      id: safeId(u.id),
      name: unitName(u),
      localName: known(p.name) ? p.name : unitName(u),
      kind:
        kindOverride ??
        // Natural Earth sometimes files two names as one ("Voivodeship|Province"); the first is the unit's own.
        (known(p.type_en) ? p.type_en.split('|')[0] : known(p.type) ? String(p.type).split('|')[0] : this.config.ne?.kind ?? NE_LEVEL_NAMES[this.id]?.[1] ?? null),
      code: iso && iso.includes('-') ? iso.split('-').slice(1).join('-') : (known(p.postal) ? p.postal : safeId(u.id)),
      iso31662: iso,
      hasc: known(p.code_hasc) ? p.code_hasc : null,
      wikidata: known(p.wikidataid) ? p.wikidataid : null,
      polygons: u.polygons,
      members: [u.id],
      memberNames: [unitName(u)],
      credits: ['naturalearth'],
      source: { dataset: 'Natural Earth admin-1', ids: [u.id] },
      neFeature: true,
    }
  }

  async buildGroup(levelId, spec) {
    const recipe = spec.group
    const keyOf = new Map() // unit id -> group key
    const names = { ...(recipe.names ?? {}) }

    if (recipe.table) {
      for (const [key, def] of Object.entries(recipe.table)) {
        const members = typeof def.members === 'function' ? this.units.filter((u) => def.members(u.props)) : this.match(def.members ?? [])
        for (const u of members) {
          if (keyOf.has(u.id) && keyOf.get(u.id) !== key) this.problem(`${levelId}: ${u.id} is listed in both ${keyOf.get(u.id)} and ${key}`)
          keyOf.set(u.id, key)
        }
        names[key] = { ...(typeof names[key] === 'string' ? { name: names[key] } : names[key] ?? {}), ...def }
      }
    } else if (recipe.absorb) {
      for (const [target, members] of Object.entries(recipe.absorb)) {
        const [host] = this.match([target])
        if (!host) continue
        keyOf.set(host.id, target)
        for (const u of this.match(members)) keyOf.set(u.id, target)
        const own = this.neFeature(host)
        names[target] = {
          name: own.name,
          kind: own.kind,
          local: own.localName,
          code: own.iso31662 ?? own.id,
          ...(typeof names[target] === 'string' ? { name: names[target] } : names[target] ?? {}),
        }
      }
    } else if (recipe.key) {
      const fn = typeof recipe.key === 'function' ? recipe.key : (p) => p[recipe.key]
      for (const u of this.units) {
        const key = fn(u.props)
        if (known(key)) keyOf.set(u.id, String(key))
      }
    } else if (recipe.within) {
      const source = await this.loadSource(recipe.within)
      const references = source.features.map((f) => ({ name: f.properties.shapeName, ...indexed(polygonsOf(f.geometry)) }))
      for (const u of this.units) {
        const point = interiorPoint(u.polygons)
        let hit = references.find((r) => contains(r, point))
        if (!hit) {
          // An island or a coastal unit the other source draws a little differently: the nearest.
          hit = nearestReference(references, point)
          if (hit) this.notes.push(`${this.id}: ${levelId}: ${u.id} (${unitName(u)}) lies in no ${source.dataset} unit; given to the nearest, ${hit.name}`)
        }
        if (hit) keyOf.set(u.id, hit.name)
      }
    }

    // Whatever the recipe leaves: itself, the named rest, or a reported gap.
    for (const u of this.units) {
      if (keyOf.has(u.id)) continue
      if (recipe.rest && recipe.rest !== 'self') keyOf.set(u.id, recipe.rest)
      else {
        if (!recipe.rest && !recipe.absorb) this.problem(`${levelId}: ${u.id} (${unitName(u)}) is in no group; kept on its own`)
        keyOf.set(u.id, `self:${u.id}`)
      }
    }

    const members = new Map()
    for (const u of this.units) {
      const key = keyOf.get(u.id)
      const list = members.get(key)
      if (list) list.push(u)
      else members.set(key, [u])
    }

    const features = []
    for (const [key, list] of members) {
      const named = typeof names[key] === 'string' ? { name: names[key] } : names[key] ?? {}
      if (list.length === 1) {
        // A group of one is that unit, unchanged, under the same id.
        const feature = this.neFeature(list[0])
        if (named.name) feature.name = named.name
        if (named.local) feature.localName = named.local
        if (named.kind) feature.kind = named.kind
        features.push(feature)
        continue
      }
      const code = named.code ?? (key.startsWith('self:') ? key.slice(5) : key)
      features.push({
        id: `${this.id}-${spec.code}-${codeTag(code)}`,
        name: named.name ?? key,
        localName: named.local ?? named.name ?? key,
        kind: named.kind ?? spec.kind,
        code,
        iso31662: null,
        hasc: null,
        wikidata: named.wikidata ?? null,
        polygons: dissolve(list.map((u) => u.polygons)),
        members: list.map((u) => u.id),
        memberNames: list.map(unitName),
        credits: ['naturalearth'],
        source: { dataset: 'Natural Earth admin-1', ids: list.map((u) => u.id), grouping: recipe.within ? `geoBoundaries ${recipe.within.geoBoundaries.join(' ')}` : null },
      })
    }
    return features
  }

  async buildSplit(levelId, spec) {
    const recipe = spec.split
    const base = await this.level(recipe.base)
    const source = await this.loadSource(recipe.source)
    if (!source.attributionOnly) {
      this.problem(`${levelId}: ${source.dataset} is licensed "${source.credit.licence}", which is not attribution-only; not used for geometry`)
      return base.features.map((f) => ({ ...f }))
    }

    // One source unit per name where the source files one unit in several pieces.
    const byName = new Map()
    for (const f of source.features) {
      const name = f.properties.shapeName
      const key = recipe.merge ? name : `${name}|${f.properties.shapeID}`
      const entry = byName.get(key) ?? { name, ids: [], parts: [] }
      entry.ids.push(f.properties.shapeID)
      entry.parts.push(polygonsOf(f.geometry))
      byName.set(key, entry)
    }
    const sourceUnits = []
    for (const [key, entry] of byName) {
      let polygons = entry.parts.flat()
      if (entry.parts.length > 1) {
        try {
          polygons = clipUnion(...entry.parts)
        } catch {
          this.problem(`${levelId}: could not join the pieces of ${entry.name}`)
        }
      }
      sourceUnits.push({ key, name: entry.name, ids: entry.ids, polygons })
    }

    /*
     * `only`: the Natural Earth units that are cut. Every other unit passes through as it is —
     * the same entity, the same geometry — and only the source units lying in a cut unit are
     * used.
     */
    const cutIds = recipe.only ? new Set(this.match(recipe.only).map((u) => u.id)) : null
    const cutBases = cutIds ? base.features.filter((f) => cutIds.has(f.id)) : base.features
    let units = sourceUnits
    if (cutIds) {
      const inside = cutBases.map((b) => indexed(b.polygons.map(oriented)))
      units = units.filter((u) => {
        const point = interiorPoint(u.polygons)
        return point !== null && inside.some((entry) => contains(entry, point))
      })
    }

    /*
     * `join`: source units joined into named pieces, `{ Name: [source unit names] }`. The units
     * named nowhere form the remainder, which keeps the cut unit's own id, name and description
     * — the same entity, less what was taken out of it — so values an older map gave it stay
     * with the part it still is.
     */
    if (recipe.join) {
      const pieceOf = new Map()
      for (const [name, members] of Object.entries(recipe.join)) {
        for (const member of members) {
          if (!units.some((u) => u.name === member)) {
            this.problem(`${levelId}: "${member}" is not a ${source.dataset} unit inside the units cut`)
          }
          pieceOf.set(member, name)
        }
      }
      const joined = new Map()
      for (const u of units) {
        const name = pieceOf.get(u.name) ?? REMAINDER
        const entry = joined.get(name) ?? { key: name, name, ids: [], parts: [] }
        entry.ids.push(...u.ids)
        entry.parts.push(u.polygons)
        joined.set(name, entry)
      }
      units = []
      for (const entry of joined.values()) {
        let polygons = entry.parts.flat()
        if (entry.parts.length > 1) {
          try {
            polygons = clipUnion(...entry.parts)
          } catch {
            this.problem(`${levelId}: could not join the source units of ${entry.name === REMAINDER ? 'the remainder' : entry.name}`)
          }
        }
        units.push({ key: entry.key, name: entry.name, ids: entry.ids, polygons })
      }
    }

    const { pieces, report } = split(
      cutBases.map((f) => ({ id: f.id, polygons: f.polygons })),
      units,
    )
    this.splitReports ??= {}
    this.splitReports[levelId] = {
      unassignedSources: report.unassignedSources.length,
      reconciledKm2: report.reconciledKm2,
      clipFailures: report.clipFailures,
      unsplitBases: report.emptyBases,
    }
    for (const failure of report.clipFailures) this.problem(`${levelId}: clipping failed ${JSON.stringify(failure)}`)

    const baseById = new Map(base.features.map((f) => [f.id, f]))

    /*
     * With `join`, only the cut line is new.
     *
     * The remainder is the cut unit less the joined pieces — not what the remainder's own
     * source units cover, whose outline crosses the unit's all along its borders: every such
     * crossing would become a vertex of the neighbour across that border too, changing units
     * the cut never reached. And a point clipping created on a piece's outline that no other
     * piece of the unit shares — a crossing of the source's outline with the unit's own, not
     * a point of the cut — is dropped: it lies on the unit's edge to 2 cm, and kept, the
     * noding would put it into the neighbour's border as well. What is left new is the cut
     * line, and its two ends where it meets the unit's outline.
     */
    if (recipe.join) {
      for (const baseId of new Set(pieces.map((p) => p.baseId))) {
        const own = pieces.filter((p) => p.baseId === baseId)
        const rest = own.find((p) => p.source?.name === REMAINDER)
        const named = own.filter((p) => p.source && p.source.name !== REMAINDER)
        if (!rest || named.length === 0) continue
        // `stopAt`: each joined piece ends at the water, which stays with the rest — see `endAtWater`.
        if (recipe.stopAt) {
          const water = waterCutter(recipe.stopAt)
          for (const piece of named) {
            const ended = endAtWater(piece.polygons, water)
            if (!ended) {
              this.problem(`${levelId}: could not end ${piece.source.name} at the ${recipe.stopAt.river}`)
              continue
            }
            piece.polygons = ended.polygons
            console.log(`[admin] ${this.id}: ${piece.source.name} ends at the ${recipe.stopAt.river} and its estuary — ${ended.keptKm2.toFixed(0)} km2, ${ended.movedKm2.toFixed(0)} km2 it cut off given to the rest`)
          }
        }
        const less = clipDifference(baseById.get(baseId).polygons, ...named.map((p) => p.polygons))
        if (less.error || less.length === 0) this.problem(`${levelId}: could not take the joined pieces out of ${baseId}`)
        // Wound as `split` winds its pieces: Clipper's winding reads to d3 as the rest of the globe.
        else rest.polygons = despiked(less).map(oriented)
        const createdKeys = new Set(created.map(([x, y]) => `${x},${y}`))
        const holders = new Map()
        for (const piece of own) {
          const seen = new Set()
          for (const polygon of piece.polygons) for (const ring of polygon) for (const [x, y] of ring) seen.add(`${x},${y}`)
          for (const key of seen) holders.set(key, (holders.get(key) ?? 0) + 1)
        }
        for (const piece of own) {
          piece.polygons = piece.polygons.map((polygon) =>
            polygon.map((ring) => {
              const open = ring.slice(0, -1).filter(([x, y]) => {
                const key = `${x},${y}`
                return !createdKeys.has(key) || holders.get(key) > 1
              })
              return open.length >= 3 ? [...open, open[0]] : ring
            }),
          )
        }
        // And from the points the noding inserts, which would otherwise put it straight back.
        const dropped = new Set([...holders].filter(([key, n]) => n === 1 && createdKeys.has(key)).map(([key]) => key))
        for (let i = created.length - 1; i >= 0; i--) if (dropped.has(`${created[i][0]},${created[i][1]}`)) created.splice(i, 1)
      }
    }

    const perBase = new Map()
    for (const piece of pieces) perBase.set(piece.baseId, (perBase.get(piece.baseId) ?? 0) + 1)
    const used = new Set()
    const features = []
    // The units `only` leaves alone.
    if (cutIds) for (const f of base.features) if (!cutIds.has(f.id)) features.push({ ...f })
    for (const piece of pieces) {
      const parent = baseById.get(piece.baseId)
      // One piece is the base unit itself: the same land, so the same entity.
      if (!piece.source || perBase.get(piece.baseId) === 1) {
        features.push({ ...parent })
        continue
      }
      // What `join` left of the unit is the unit: its own id, less what was taken out.
      if (recipe.join && piece.source.name === REMAINDER) {
        features.push({ ...parent, polygons: piece.polygons, derived: true })
        continue
      }
      const name = recipe.name ? recipe.name(piece.source.name) : piece.source.name
      let id = `${this.id}-${spec.code}-${slug(name)}`
      for (let n = 2; used.has(id); n++) id = `${this.id}-${spec.code}-${slug(name)}-${n}`
      used.add(id)
      features.push({
        id,
        name,
        localName: name,
        kind: recipe.kindOf ? recipe.kindOf(piece.source.name) : spec.kind,
        code: slug(name),
        iso31662: null,
        hasc: null,
        wikidata: null,
        polygons: piece.polygons,
        // Cut by a clipper: its vertices are checked against every ring around it (`node`).
        derived: true,
        members: parent.members,
        memberNames: parent.memberNames,
        credits: ['naturalearth', source.id],
        source: { dataset: source.dataset, ids: piece.source.ids, outline: 'Natural Earth admin-1' },
      })
    }
    return features
  }

  async loadSource(ref) {
    if (!ref.geoBoundaries) throw new Error(`${this.id}: unknown source ${JSON.stringify(ref)}`)
    const source = await this.sources.geoBoundaries(...ref.geoBoundaries)
    const entry = this.credits.get(source.id) ?? { ...source.credit, id: source.id, countries: new Set(), geometry: false }
    entry.countries.add(this.id)
    this.credits.set(source.id, entry)
    return source
  }

  /** The level each preset uses. */
  async presets() {
    const c = this.config
    let curated = c.curated
    if (!curated) {
      const area = areaKm2(this.units.flatMap((u) => u.polygons))
      curated = this.units.length > 1 && area < POLICY.wholeCountryBelowKm2 ? 'country' : 'ne'
      this.policyApplied = curated === 'country'
    }
    const detailed = c.detailed ?? curated
    let maximum = c.maximum
    if (!maximum) {
      const finer = (await this.level('ne')).features.length > (await this.level(detailed)).features.length
      maximum = finer ? 'ne' : detailed
    }
    return { curated, detailed, maximum }
  }
}

function unitName(u) {
  const p = u.props
  return known(p.name_en) ? p.name_en : known(p.name) ? p.name : u.id
}

function nearestReference(references, point) {
  let best = null
  let bestD = Infinity
  for (const r of references) {
    for (const polygon of r.polygons) {
      const ring = polygon[0]
      for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 200))) {
        const d = (ring[i][0] - point[0]) ** 2 + (ring[i][1] - point[1]) ** 2
        if (d < bestD) {
          bestD = d
          best = r
        }
      }
    }
  }
  return best
}

/* ----------------------------------------------------------------- groups */

/**
 * The regions a unit belongs to: the country's configured groups, reached through the
 * Natural Earth units it was made from, and every coarser level of the same country that
 * contains it. A Kreis is in its Regierungsbezirk and its Land; a Spanish province is in
 * its autonomous community.
 */
function assignGroups(country, levelsInUse) {
  const unitGroups = new Map() // NE unit id -> [{scheme, key, name, approximate, note}]
  for (const scheme of country.config.groups ?? []) {
    const add = (units, key, name) => {
      for (const u of units) {
        const list = unitGroups.get(u.id) ?? []
        list.push({ scheme: scheme.scheme, key, name, approximate: !!scheme.approximate, note: scheme.note ?? null })
        unitGroups.set(u.id, list)
      }
    }
    if (scheme.table) {
      for (const [name, members] of Object.entries(scheme.table)) add(country.match(members), name, name)
    } else if (scheme.key) {
      const fn = typeof scheme.key === 'function' ? scheme.key : (p) => p[scheme.key]
      for (const u of country.units) {
        const key = fn(u.props)
        if (!known(key)) continue
        const named = scheme.names?.[key]
        add([u], String(key), typeof named === 'string' ? named : named?.name ?? String(key))
      }
    }
  }

  const built = [...country.levels.values()].filter((l) => l.features.length > 1)
  for (const level of levelsInUse) {
    for (const feature of level.features) {
      const groups = []
      // Configured schemes: a unit is in a group when every unit it was made from is.
      const byScheme = new Map()
      for (const member of feature.members) {
        for (const g of unitGroups.get(member) ?? []) {
          const entry = byScheme.get(g.scheme) ?? new Map()
          entry.set(g.key, { ...g, count: (entry.get(g.key)?.count ?? 0) + 1 })
          byScheme.set(g.scheme, entry)
        }
      }
      for (const [scheme, entries] of byScheme) {
        for (const g of entries.values()) {
          if (g.count !== feature.members.length) continue
          groups.push({ scheme, id: `${country.id}-G-${slug(scheme)}-${slug(g.key)}`, name: g.name, ...(g.approximate ? { approximate: true } : {}) })
        }
      }
      // Coarser levels of the same country: the unit there that holds this one.
      const point = feature.point
      for (const other of built) {
        if (other === level || other.features.length >= level.features.length) continue
        const holder = other.features.find((f) => f.indexed && contains(f.indexed, point))
        if (!holder || holder.id === feature.id) continue
        groups.push({ scheme: other.kind ?? other.name, id: holder.id, name: holder.name, level: other.id })
      }
      feature.groups = groups
    }
  }
}

/* ------------------------------------------------------------------ the build */

export async function buildAdministrative({ root, units, table, refresh = false, log = console.log }) {
  const outDir = resolve(root, 'data/admin')
  mkdirSync(outDir, { recursive: true })
  const sources = createSources(root, { refresh })
  const credits = new Map([['naturalearth', { ...NATURAL_EARTH_CREDIT, id: 'naturalearth', countries: new Set(), geometry: true }]])
  const problems = []

  /*
   * Exact repeats of one polygon (see `uniquePolygons`) go before anything else — inside a
   * unit, and across the units of one country, where an islet filed under two provinces
   * would otherwise read as a border between them rather than as coast. The first unit to
   * list it keeps it.
   */
  let repeats = 0
  const seenByCountry = new Map()
  for (const u of [...units].sort((a, b) => a.id.localeCompare(b.id))) {
    const seen = seenByCountry.get(u.parent) ?? new Set()
    seenByCountry.set(u.parent, seen)
    const unique = []
    for (const polygon of uniquePolygons(u.polygons)) {
      const key = polygonKey(polygon)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(polygon)
    }
    repeats += u.polygons.length - unique.length
    u.polygons = unique
  }
  if (repeats) log(`[admin] ${repeats} repeated polygons removed from Natural Earth units`)

  // Clipping records the points it creates; the noding puts each on every ring it lies on.
  created.length = 0

  const byCountry = new Map()
  for (const u of units) {
    if (!u.parent) continue
    const list = byCountry.get(u.parent) ?? []
    list.push(u)
    byCountry.set(u.parent, list)
  }
  for (const id of Object.keys(COUNTRIES)) {
    if (!byCountry.has(id)) problems.push(`${id}: configured but has no Natural Earth units`)
  }

  const countries = []
  for (const [id, list] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.id.localeCompare(b.id))
    const country = new Country(id, list, COUNTRIES[id] ?? {}, table, sources, credits, problems)
    country.presetLevels = await country.presets()
    // Natural Earth's own level too, for every country: it is the reference the presets'
    // coasts and borders are checked against, whether or not any preset shows it.
    for (const levelId of new Set([...Object.values(country.presetLevels), 'ne'])) await country.level(levelId)
    countries.push(country)
  }
  log(`[admin] ${countries.length} countries, ${Object.keys(COUNTRIES).length} configured`)

  /* ---- index geometry for validation and groups, before anything is quantised */
  const report = { generatedAt: new Date().toISOString(), policy: POLICY, countries: {}, problems }
  const allIds = new Map()
  for (const country of countries) {
    const inUse = [...new Set(Object.values(country.presetLevels))].map((id) => country.levels.get(id))
    for (const level of country.levels.values()) {
      for (const f of level.features) {
        f.indexed = indexed(f.polygons.map(oriented))
        f.point = interiorPoint(f.polygons) ?? [0, 0]
        f.areaKm2 = areaKm2(f.polygons)
      }
    }
    assignGroups(country, inUse)

    // Coverage: each Natural Earth polygon's inside point is in exactly one unit.
    const samples = []
    for (const u of country.units) for (const p of u.polygons) samples.push(interiorPoint([p]))
    const levels = {}
    for (const level of inUse) {
      let gaps = 0
      let overlaps = 0
      const gapAt = []
      for (const point of samples) {
        if (!point) continue
        let n = 0
        for (const f of level.features) if (contains(f.indexed, point)) n++
        if (n === 0) {
          gaps++
          if (gapAt.length < 5) gapAt.push(point.map((v) => Number(v.toFixed(3))))
        } else if (n > 1) overlaps++
      }
      const areas = level.features.map((f) => f.areaKm2).sort((a, b) => a - b)
      levels[level.id] = {
        name: level.name,
        units: level.features.length,
        smallestKm2: Math.round(areas[0] ?? 0),
        medianKm2: Math.round(areas[Math.floor(areas.length / 2)] ?? 0),
        largestKm2: Math.round(areas[areas.length - 1] ?? 0),
        samples: samples.length,
        gaps,
        overlaps,
        ...(gapAt.length ? { gapAt } : {}),
        ...(country.splitReports?.[level.id] ? { split: country.splitReports[level.id] } : {}),
      }
      if (gaps || overlaps) problems.push(`${country.id}.${level.id}: ${gaps} gaps, ${overlaps} overlaps of ${samples.length} sampled polygons`)
      for (const f of level.features) {
        const seen = allIds.get(f.id)
        if (seen && seen.feature !== f && !(seen.country === country.id && sameGeometry(seen.feature, f))) {
          problems.push(`id ${f.id} is used by two different units (${seen.country}.${seen.level} and ${country.id}.${level.id})`)
        }
        allIds.set(f.id, { country: country.id, level: level.id, feature: f })
      }
    }
    report.countries[country.id] = {
      name: country.name,
      presets: country.presetLevels,
      naturalEarthUnits: country.units.length,
      ...(country.policyApplied ? { policy: `one unit: under ${POLICY.wholeCountryBelowKm2} km²` } : {}),
      ...(country.config.note ? { note: country.config.note } : {}),
      ...(country.notes.length ? { notes: country.notes } : {}),
      levels,
    }
  }

  /* ---- one topology for every level in use, sharing its borders */
  const objects = {}
  const levelFeatures = new Map()
  const unique = new Set()
  for (const country of countries) {
    for (const levelId of new Set([...Object.values(country.presetLevels), 'ne'])) {
      const level = country.levels.get(levelId)
      levelFeatures.set(`${country.id}~${levelId}`, level)
      for (const f of level.features) unique.add(f)
    }
  }
  // Clones share polygon arrays with the feature they copy; node each array once.
  const byPolygons = new Map()
  for (const f of unique) if (!byPolygons.has(f.polygons)) byPolygons.set(f.polygons, f)
  const noding = [...byPolygons.values()]
  const nodeStats = node(noding, created)
  /*
   * Not dissolved again here. A long, thin strip joined to a piece comes back as a loop pinched
   * at a vertex, and TopoJSON's merge of such rings produced straight chords of up to 147 km
   * across Germany; measured on Belgium and Germany, removing back-tracks alone leaves no arc
   * that differs from Natural Earth's, and dissolving on top of it brings the chords back.
   */
  /*
   * And a crossing put on an edge of a ring that already ran through it — a loop pinched at a
   * vertex — can leave the ring stepping out to it and straight back. The step bounds nothing
   * and no other ring has it; it goes, as it did before the noding.
   */
  for (const f of noding) if (f.derived) f.polygons = despiked(f.polygons)
  /*
   * With the copies of each crossing now one point, a piece's polygons that meet along an
   * edge share it exactly, and a union joins them without creating anything: a line inside
   * one unit is not a coast. (A union, not a TopoJSON dissolve — the dissolve mishandled the
   * pinched loops thin strips come back as and drew chords across the land.)
   */
  let joined = 0
  for (const f of noding) {
    if (!f.derived || f.polygons.length < 2) continue
    try {
      const union = despiked(clipUnion(f.polygons).map(oriented))
      if (union.length < f.polygons.length) joined += f.polygons.length - union.length
      f.polygons = union
    } catch (error) {
      problems.push(`${f.id}: could not join its polygons (${error.message})`)
    }
  }
  nodeStats.joined = joined
  // `node` gave each noded feature new polygons; a clone still holds the old array, which
  // still keys its original in `byPolygons`.
  for (const f of unique) f.polygons = byPolygons.get(f.polygons)?.polygons ?? f.polygons
  log(`[admin] noding: ${nodeStats.created} points created by cuts, ${nodeStats.snapped} snapped, ${nodeStats.inserted} inserted into the rings they lie on`)
  report.noding = nodeStats

  for (const [key, level] of levelFeatures) {
    objects[key] = {
      type: 'FeatureCollection',
      features: level.features
        .filter((f) => f.polygons.length > 0)
        .map((f) => ({ type: 'Feature', id: f.id, geometry: { type: 'MultiPolygon', coordinates: f.polygons } })),
    }
  }
  const topology = topojson.topology(objects, QUANTIZATION)

  /* ---- the base, and a fragment per other level */
  const arcsOf = (geometry, out = []) => {
    const walk = (a) => {
      if (typeof a === 'number') out.push(a < 0 ? ~a : a)
      else for (const x of a) walk(x)
    }
    walk(geometry.arcs ?? [])
    return out
  }
  const remapArcs = (geometry, map) => {
    const walk = (a) => (typeof a === 'number' ? (a < 0 ? ~map.get(~a) : map.get(a)) : a.map(walk))
    return { type: geometry.type, id: geometry.id, arcs: walk(geometry.arcs) }
  }

  const geometriesOf = (key) => topology.objects[key]?.geometries?.filter((g) => g.type) ?? []
  const baseGeometries = []
  const baseArcMap = new Map()
  for (const country of countries) {
    for (const g of geometriesOf(`${country.id}~${country.presetLevels.curated}`)) {
      baseGeometries.push(g)
      for (const a of arcsOf(g)) if (!baseArcMap.has(a)) baseArcMap.set(a, baseArcMap.size)
    }
  }
  const baseArcs = new Array(baseArcMap.size)
  for (const [old, index] of baseArcMap) baseArcs[index] = topology.arcs[old]
  const N = baseArcs.length

  for (const file of existsSync(outDir) ? readdirSync(outDir) : []) if (file.endsWith('.json')) rmSync(resolve(outDir, file))

  const written = {}
  const write = (name, value) => {
    const text = JSON.stringify(value)
    writeFileSync(resolve(outDir, name), text)
    written[name] = text.length
  }

  const entityOf = (country, level, f) => {
    const parent = country.meta
    const point = f.point
    const credit = f.credits.filter((c) => c !== 'naturalearth')
    return {
      id: f.id,
      iso2: null,
      code: f.code ?? f.id,
      numeric: null,
      name: f.name,
      officialName: f.localName ?? f.name,
      region: parent?.region ?? 'Unknown',
      subregion: parent?.subregion ?? parent?.region ?? 'Unknown',
      independent: false,
      lat: Number(point[1].toFixed(4)),
      lng: Number(point[0].toFixed(4)),
      parent: { id: country.id, name: country.name, iso2: parent?.iso2 ?? null },
      // A Natural Earth unit kept inside a coarser level is still what it was, not that level's kind.
      kind: f.kind ?? (f.neFeature && level.id !== 'ne' ? null : level.kind) ?? null,
      level: { id: level.id, name: level.name },
      ...(f.groups?.length ? { groups: f.groups } : {}),
      ...(f.members.length > 1 ? { members: f.memberNames } : {}),
      source: {
        dataset: f.source.dataset,
        ids: f.source.ids,
        ...(f.source.outline ? { outline: f.source.outline } : {}),
        ...(f.source.grouping ? { grouping: f.source.grouping } : {}),
        iso31662: f.iso31662 ?? null,
        hasc: f.hasc ?? null,
        wikidata: f.wikidata ?? null,
        credits: ['naturalearth', ...credit],
      },
    }
  }

  const baseEntities = {}
  for (const country of countries) {
    const level = country.levels.get(country.presetLevels.curated)
    for (const f of level.features) baseEntities[f.id] = entityOf(country, level, f)
    for (const c of level.credits) credits.get(c)?.countries.add(country.id)
  }

  write('base.json', {
    type: 'Topology',
    bbox: topology.bbox,
    transform: topology.transform,
    objects: { provinces: { type: 'GeometryCollection', geometries: baseGeometries.map((g) => remapArcs(g, baseArcMap)) } },
    arcs: baseArcs,
  })
  write('base-meta.json', { generatedAt: report.generatedAt, numericToId: {}, nameToId: {}, entities: baseEntities })

  const fragments = {}
  for (const country of countries) {
    for (const levelId of new Set([country.presetLevels.detailed, country.presetLevels.maximum])) {
      if (levelId === country.presetLevels.curated) continue
      const level = country.levels.get(levelId)
      const geometries = geometriesOf(`${country.id}~${levelId}`)
      const local = new Map()
      for (const g of geometries) for (const a of arcsOf(g)) if (!baseArcMap.has(a) && !local.has(a)) local.set(a, N + local.size)
      const map = new Map([...baseArcMap, ...local])
      const arcs = new Array(local.size)
      for (const [old, index] of local) arcs[index - N] = topology.arcs[old]
      const entities = {}
      for (const f of level.features) entities[f.id] = entityOf(country, level, f)
      for (const c of level.credits) credits.get(c)?.countries.add(country.id)
      const file = `${country.id}.${levelId}.json`
      write(file, { country: country.id, level: levelId, baseArcs: N, arcs, geometries: geometries.map((g) => remapArcs(g, map)), entities })
      fragments[`${country.id}~${levelId}`] = { file, units: level.features.length }
    }
  }

  /*
   * ---- composition check: every preset has Natural Earth's own coast and national borders.
   * The reference is every country at Natural Earth's level — the untouched source — so a
   * border a cut failed to share shows up even where two presets would agree with each other.
   */
  const networks = (preset) => {
    const users = new Map() // arc -> [country, count]
    for (const country of countries) {
      const levelId = preset === 'reference' ? 'ne' : country.presetLevels[preset]
      for (const g of geometriesOf(`${country.id}~${levelId}`)) {
        for (const a of arcsOf(g)) {
          const list = users.get(a) ?? []
          list.push(country.id)
          users.set(a, list)
        }
      }
    }
    const coast = new Set()
    const national = new Set()
    for (const [a, list] of users) {
      if (list.length === 1) coast.add(a)
      else if (list.length === 2 && list[0] !== list[1]) national.add(a)
    }
    return { users, coast, national }
  }

  const [sx, sy] = topology.transform.scale
  const [tx, ty] = topology.transform.translate
  const decoded = (a) => {
    let x = 0
    let y = 0
    return topology.arcs[a].map(([dx, dy]) => [(x += dx), (y += dy)])
  }
  const degrees = ([x, y]) => [Number((tx + x * sx).toFixed(4)), Number((ty + y * sy).toFixed(4))]
  const arcKm = (a) => {
    const points = decoded(a).map(degrees)
    let length = 0
    for (let i = 1; i < points.length; i++) length += km(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    return length
  }

  const reference = networks('reference')
  const referenceCoastPoints = new Set()
  for (const a of reference.coast) for (const [x, y] of decoded(a)) referenceCoastPoints.add(x * 1e7 + y)

  /*
   * Every arc a preset draws as coast that the reference does not, sorted by what it was:
   *   lostBorder       two countries shared it in the reference — a national border drawn as coast
   *   internalAsCoast  one country used it twice — an internal border drawn as coast
   *   newLine          a new arc off the reference coast — a cut line that lost its partner
   *   coastFromUnion   a new arc along the reference coast — where an islet Natural Earth laid
   *                    over the shore was clipped together with it; nothing is drawn wrong
   * Only the first three are faults.
   */
  const FAULTS = ['lostBorder', 'internalAsCoast', 'newLine']
  report.composition = {}
  for (const preset of PRESETS) {
    const n = networks(preset)
    const kinds = Object.fromEntries([...FAULTS, 'coastFromUnion'].map((k) => [k, { arcs: 0, km: 0, countries: {}, samples: [] }]))
    const longest = []
    for (const a of n.coast) {
      if (reference.coast.has(a)) continue
      const country = n.users.get(a)[0]
      const referenceUsers = reference.users.get(a)
      let kind
      if (referenceUsers && referenceUsers.length >= 2) kind = referenceUsers[0] !== referenceUsers[1] ? 'lostBorder' : 'internalAsCoast'
      else {
        const points = decoded(a)
        const inner = points.length > 2 ? points.slice(1, -1) : points
        const along = inner.filter(([x, y]) => referenceCoastPoints.has(x * 1e7 + y)).length
        kind = along / inner.length >= 0.5 ? 'coastFromUnion' : 'newLine'
      }
      const entry = kinds[kind]
      const length = arcKm(a)
      entry.arcs++
      entry.km += length
      entry.countries[country] = (entry.countries[country] ?? 0) + 1
      if (FAULTS.includes(kind) && entry.samples.length < 12) entry.samples.push({ country, from: degrees(decoded(a)[0]) })
      if (FAULTS.includes(kind)) {
        const points = decoded(a)
        longest.push({ kind, country, km: Number(length.toFixed(2)), from: degrees(points[0]), to: degrees(points[points.length - 1]), points: points.length })
      }
    }
    for (const entry of Object.values(kinds)) entry.km = Number(entry.km.toFixed(1))
    const lostNational = [...reference.national].filter((a) => !n.national.has(a) && !n.coast.has(a)).length
    longest.sort((x, y) => y.km - x.km)
    report.composition[preset] = { ...kinds, nationalArcsReplaced: lostNational, longestFaults: longest.slice(0, 25) }
    const faults = FAULTS.reduce((sum, k) => sum + kinds[k].arcs, 0)
    if (faults) {
      problems.push(
        `${preset}: ${faults} arcs drawn as coast that are not (${FAULTS.map((k) => `${k} ${kinds[k].arcs}, ${kinds[k].km} km`).join('; ')}) in ` +
          [...new Set(FAULTS.flatMap((k) => Object.keys(kinds[k].countries)))].join(', '),
      )
    }
  }

  /* ---- index */
  const index = {
    generatedAt: report.generatedAt,
    baseArcs: N,
    presets: {
      curated: { label: 'Curated Default' },
      detailed: { label: 'More Detailed' },
      maximum: { label: 'Maximum Available Detail' },
    },
    countries: {},
    fragments,
    sources: [...credits.values()]
      .filter((c) => c.countries.size > 0)
      .map((c) => ({ id: c.id, name: c.name, agency: c.agency, licence: c.licence, year: c.year, url: c.url, via: c.via ?? null, countries: [...c.countries].sort() })),
  }
  for (const country of countries) {
    const levels = {}
    for (const levelId of new Set(Object.values(country.presetLevels))) {
      const level = country.levels.get(levelId)
      levels[levelId] = {
        name: level.name,
        kind: level.kind,
        adminLevel: level.adminLevel ?? null,
        vintage: level.vintage ?? null,
        units: level.features.length,
        credits: level.credits,
      }
    }
    index.countries[country.id] = { name: country.name, ...country.presetLevels, levels, ...(country.config.note ? { note: country.config.note } : {}) }
  }
  write('index.json', index)

  report.totals = Object.fromEntries(
    PRESETS.map((preset) => [preset, countries.reduce((sum, c) => sum + c.levels.get(c.presetLevels[preset]).features.length, 0)]),
  )
  report.outputs = Object.fromEntries(Object.entries(written).map(([k, v]) => [k, `${(v / 1e6).toFixed(2)} MB`]))
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 1))

  log(`[admin] units: curated ${report.totals.curated}, detailed ${report.totals.detailed}, maximum ${report.totals.maximum}`)
  log(`[admin] base ${(written['base.json'] / 1e6).toFixed(2)} MB, ${Object.keys(fragments).length} fragments`)
  if (problems.length) log(`[admin] ${problems.length} problems:\n  ${problems.join('\n  ')}`)
  return report
}

function sameGeometry(a, b) {
  return a.polygons === b.polygons
}

/* --------------------------------------------------------------------- CLI */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const cached = resolve(root, '.cache/admin-units.json')
  if (!existsSync(cached)) {
    console.error('[admin] no .cache/admin-units.json — run: npm run build-geography')
    process.exit(1)
  }
  const { buildCountryTable } = await import('../country-table.mjs')
  const units = JSON.parse(readFileSync(cached, 'utf8'))
  await buildAdministrative({ root, units, table: buildCountryTable(), refresh: process.argv.includes('--refresh') })
}
