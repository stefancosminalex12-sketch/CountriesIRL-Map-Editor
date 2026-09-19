/**
 * Stage 1 of the Europe build: EuroGlobalMap's administrative areas, read and made to meet.
 *
 * An **atom** is one area at the finest level EuroGlobalMap describes it: the rows of
 * `PolbndA` that share a country code and the whole chain of EuroBoundaryMap hierarchical
 * numbers (`SHN0`…`SHN4`). Everything the Europe maps draw is made of atoms: a Polish powiat
 * is one, a German Land is its Kreise joined, a country is all of its atoms joined. Because the
 * atoms share their borders exactly (see `resolve.mjs`), so does every level made from them.
 *
 * Taken from `PolbndA`, except Serbia and Kosovo, which EuroGlobalMap keeps only in its two
 * optional layers. `PolbndA_optionKS` is used, which draws Kosovo as its own area, as the
 * editor's World map does.
 *
 * Kept: main, branch and special areas (`TAA` 2), and areas in dispute (`TAA` 8) that are land.
 * Left out: coastal water (`TAA` 5), and the territories outside Europe: French Guiana,
 * Guadeloupe, Martinique, Mayotte, Réunion, Saint-Barthélemy, Saint-Martin,
 * Saint-Pierre-et-Miquelon and Sint Maarten.
 *
 * The result is cached in `.cache/egm/atoms.json`, keyed by the GeoPackage's size and date,
 * because the reconciliation takes minutes and nothing after it needs to repeat it.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { geoContains } from 'd3-geo'
import * as clip from '../admin/clip.mjs'
import { boundsOf, interiorPoint, node, oriented, uniquePolygons } from '../admin/geometry.mjs'
import { openEgm, present, rows } from './egm.mjs'
import { fillGaps, resolveOverlaps } from './resolve.mjs'

/** EuroGlobalMap's territories outside Europe. */
export const OUTSIDE_EUROPE = new Set(['GF', 'GP', 'MQ', 'YT', 'RE', 'BL', 'MF', 'PM', 'SX'])

/** A lookup of polygons by point, over a grid of their boxes. */
export function pointIndex(polygons, cell = 0.5) {
  const cells = new Map()
  const entries = polygons.map((polygon) => ({ polygon: oriented(polygon), box: boundsOf([polygon]) }))
  entries.forEach((entry, i) => {
    const [w, s, e, n] = entry.box
    for (let x = Math.floor(w / cell); x <= Math.floor(e / cell); x++)
      for (let y = Math.floor(s / cell); y <= Math.floor(n / cell); y++) {
        const k = `${x},${y}`
        const list = cells.get(k)
        if (list) list.push(i)
        else cells.set(k, [i])
      }
  })
  return (point) => {
    for (const i of cells.get(`${Math.floor(point[0] / cell)},${Math.floor(point[1] / cell)}`) ?? []) {
      const { polygon, box } = entries[i]
      if (point[0] < box[0] || point[0] > box[2] || point[1] < box[1] || point[1] > box[3]) continue
      if (geoContains({ type: 'Polygon', coordinates: polygon }, point)) return true
    }
    return false
  }
}

export function loadAtoms(root, { log = console.log, refresh = false } = {}) {
  const { path, db } = openEgm(root)
  const stat = statSync(path)
  const cachePath = resolve(root, '.cache/egm/atoms.json')
  const stamp = `${stat.size}:${stat.mtimeMs}:v4`
  if (!refresh && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (cached.stamp === stamp) {
      log(`[europe] atoms from cache (${cached.atoms.length})`)
      return cached
    }
  }

  const t0 = Date.now()
  // Land, for telling a disputed area on land from one at sea.
  const land = pointIndex([...rows(db, 'LandmaskA')].flatMap((r) => r.polygons), 0.25)
  // Water, for telling a lake from a strip between two copies of a border.
  const water = pointIndex(
    [
      ...[...rows(db, 'LakeresA', 'Shape_Area > 0.00002')].flatMap((r) => r.polygons),
      ...[...rows(db, 'PolbndA', 'TAA = 5')].flatMap((r) => r.polygons),
      ...[...rows(db, 'SeaA')].flatMap((r) => r.polygons),
    ],
    0.25,
  )
  log(`[europe] land and water indexes in ${((Date.now() - t0) / 1000).toFixed(0)} s`)

  const byKey = new Map()
  const disputes = { kept: [], atSea: [] }
  const take = (r, table) => {
    if (r.polygons.length === 0) return
    const iccs = r.ICC.split('#')
    if (iccs.some((c) => OUTSIDE_EUROPE.has(c))) return
    let key
    let info
    if (r.TAA === 8) {
      key = `dispute:${r.ICC}`
      info = { kind: 'dispute', icc: r.ICC, shn: [] }
    } else {
      const shn = [r.SHN0, r.SHN1, r.SHN2, r.SHN3, r.SHN4].map((v) => (present(v) ? v : null))
      key = `${r.ICC}:${shn.join('|')}`
      info = { kind: 'area', icc: r.ICC, shn, table }
    }
    const atom = byKey.get(key) ?? { id: key, ...info, polygons: [] }
    atom.polygons.push(...r.polygons)
    byKey.set(key, atom)
  }
  for (const r of rows(db, 'PolbndA', "TAA IN (2, 8)")) take(r, 'PolbndA')
  for (const r of rows(db, 'PolbndA_optionKS', "TAA IN (2, 8) AND ICC IN ('RS', 'KS')")) take(r, 'PolbndA_optionKS')

  /*
   * Areas in dispute, piece by piece: a piece at sea (the Ems–Dollart estuary, Piran Bay) is
   * water, and a piece on land (the strips along the Dragonja and the Mura) is land in dispute.
   * Judged per piece, because one dispute holds both: taken whole, Croatia–Slovenia's largest
   * piece is the bay, and its land strips went to one of the two countries.
   */
  for (const [key, atom] of byKey) {
    if (atom.kind !== 'dispute') continue
    const onLand = atom.polygons.filter((polygon) => {
      const point = interiorPoint([polygon])
      return point && land(point)
    })
    const atSea = atom.polygons.length - onLand.length
    if (atSea) disputes.atSea.push(`${atom.icc} (${atSea} of ${atom.polygons.length} pieces)`)
    if (onLand.length === 0) byKey.delete(key)
    else {
      atom.polygons = onLand
      disputes.kept.push(`${atom.icc} (${onLand.length} pieces)`)
    }
  }

  /*
   * Order decides who gives way where two copies of a border overlap. Areas in dispute first:
   * EuroGlobalMap also draws them inside one country's areas, and they must not disappear into
   * it. Then countries and areas in a fixed order, so a rebuild reconciles the same way.
   */
  const atoms = [...byKey.values()]
    .map((a) => ({ ...a, polygons: uniquePolygons(a.polygons) }))
    .sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === 'dispute' ? -1 : 1))
  log(`[europe] ${atoms.length} atoms (${disputes.kept.length} disputed on land, ${disputes.atSea.length} at sea left out)`)

  const t1 = Date.now()
  const overlaps = resolveOverlaps(atoms, (m) => log(`[europe] ${m}`))
  log(`[europe] overlaps resolved in ${((Date.now() - t1) / 1000).toFixed(0)} s: ${JSON.stringify({ ...overlaps, emptied: overlaps.emptied.length })}`)
  // Noded before the gaps are looked for: the merge that finds them needs shared borders.
  const kept = atoms.filter((a) => a.polygons.length > 0)
  const firstNoding = node(kept, clip.created)
  log(`[europe] noded: ${JSON.stringify(firstNoding)}`)
  const t2 = Date.now()
  const gaps = fillGaps(kept, water, { log: (m) => log(`[europe] ${m}`) })
  log(`[europe] gaps filled in ${((Date.now() - t2) / 1000).toFixed(0)} s: ${JSON.stringify({ ...gaps, large: gaps.large.length })}`)
  // Joining a strip to an area creates points where the strip's ends meet; node them too.
  const noded = { first: firstNoding, second: node(kept, clip.created) }
  log(`[europe] noded again: ${JSON.stringify(noded.second)}`)

  const result = {
    stamp,
    source: 'EuroGlobalMap 2026',
    report: { overlaps, gaps, noded, disputes },
    atoms: kept.map(({ box, ...a }) => a),
  }
  writeFileSync(cachePath, JSON.stringify(result))
  log(`[europe] atoms cached (${kept.length}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  return result
}
