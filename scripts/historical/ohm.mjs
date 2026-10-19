/**
 * Historical countries from OpenHistoricalMap, for the 1914, 1938 and 1945 maps.
 *
 * OpenHistoricalMap (openhistoricalmap.org) is OpenStreetMap's historical twin: borders traced
 * from historical maps, each country a relation with the dates it held (`start_date`,
 * `end_date`). Its data is dedicated to the public domain (CC0). The countries of a day are the
 * administrative-level-2 relations valid on it.
 *
 * Its borders are what the historical-basemaps borders were not: drawn at the scale of a
 * topographic map, so they follow rivers and ridges instead of running in straight lines between
 * a few points. They are simplified once here — way by way, so a border two countries share stays
 * one line — to about the World map's own detail, then assembled into polygons.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter'
/** How far a dropped point may lie from the line that replaces it: finer than the 25m map's. */
const TOLERANCE_KM = 0.4

/** Every administrative-level-2 relation valid on `date` (YYYY-MM-DD), with its ways' geometry. */
export async function fetchDay(date, cacheDir, refresh = false) {
  const file = resolve(cacheDir, `geom-${date}.json`)
  if (refresh || !existsSync(file)) {
    const query = `[out:json][timeout:600][maxsize:2000000000];relation["boundary"="administrative"]["admin_level"="2"](if: t["start_date"] <= "${date}" && (!is_tag("end_date") || t["end_date"] > "${date}"));out geom;`
    const response = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) })
    if (!response.ok) throw new Error(`OpenHistoricalMap ${date}: ${response.status}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Douglas–Peucker in kilometres, longitude scaled by latitude; the ends are always kept. */
function simplify(points) {
  if (points.length <= 2) return points
  const lat0 = (points[0][1] * Math.PI) / 180
  const kx = 111.32 * Math.cos(lat0)
  const ky = 110.574
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  const tol2 = TOLERANCE_KM * TOLERANCE_KM
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b - a < 2) continue
    const ax = points[a][0] * kx
    const ay = points[a][1] * ky
    const vx = points[b][0] * kx - ax
    const vy = points[b][1] * ky - ay
    const l2 = vx * vx + vy * vy
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const px = points[i][0] * kx - ax
      const py = points[i][1] * ky - ay
      let t = l2 > 0 ? (px * vx + py * vy) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const d = (px - t * vx) ** 2 + (py - t * vy) ** 2
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > tol2) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`

/** Ways joined end to end into closed rings; whatever cannot be closed is left out. */
function rings(ways) {
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w])
  const out = []
  while (open.length) {
    let ring = open.pop()
    let grown = true
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grown) {
      grown = false
      const end = key(ring[ring.length - 1])
      for (let i = 0; i < open.length; i++) {
        const w = open[i]
        if (key(w[0]) === end) ring = ring.concat(w.slice(1))
        else if (key(w[w.length - 1]) === end) ring = ring.concat([...w].reverse().slice(1))
        else continue
        open.splice(i, 1)
        grown = true
        break
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) out.push(ring)
  }
  return out
}

function inside(point, ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const planarArea = (ring) => {
  let s = 0
  for (let i = 1; i < ring.length; i++) s += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  return Math.abs(s / 2)
}

/**
 * The countries of a day, as `{ id, name, polygons }` with polygons in GeoJSON order
 * ([outer, ...holes], [lon, lat]). Relations that close no ring — a boundary line filed as a
 * relation of its own — are left out.
 */
export function countriesOf(json) {
  const simplified = new Map()
  const wayPoints = (member) => {
    let points = simplified.get(member.ref)
    if (!points) {
      points = simplify(member.geometry.map((g) => [g.lon, g.lat]))
      simplified.set(member.ref, points)
    }
    return points
  }
  const countries = []
  for (const element of json.elements) {
    if (element.type !== 'relation' || !element.members) continue
    const tags = element.tags ?? {}
    const name = tags['name:en'] ?? tags.name
    if (!name) continue
    const outerWays = []
    const innerWays = []
    for (const m of element.members) {
      if (m.type !== 'way' || !m.geometry) continue
      if (m.role === 'inner') innerWays.push(wayPoints(m))
      else if (m.role === 'outer' || m.role === '') outerWays.push(wayPoints(m))
    }
    const outers = rings(outerWays).sort((a, b) => planarArea(b) - planarArea(a))
    if (outers.length === 0) continue
    const polygons = outers.map((ring) => [ring])
    for (const hole of rings(innerWays)) {
      const owner = polygons.find((p) => inside(hole[0], p[0]))
      if (owner) owner.push(hole)
    }
    countries.push({ relation: element.id, name, start: tags.start_date ?? null, end: tags.end_date ?? null, polygons })
  }
  return countries
}
