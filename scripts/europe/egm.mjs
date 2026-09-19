/**
 * EuroGlobalMap, read straight from its GeoPackage.
 *
 * A GeoPackage is a SQLite database. Node reads it with its own `node:sqlite`, and the
 * geometry is a small GeoPackage header followed by standard WKB, decoded here. So the build
 * needs no GDAL and no native module, and reads EuroGeographics' file as delivered.
 *
 * The file is not committed (about 1 GB). Request EuroGlobalMap (GeoPackage) at
 * https://www.mapsforeurope.org, then either extract it into `.cache/egm/` or leave the
 * extracted `euro-global-map-GPKG` folder in the project root, which is git-ignored.
 */
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const CANDIDATES = [
  '.cache/egm/euro-global-map-GPKG/DATA/FullEurope/EuroGlobalMap_2026.gpkg',
  'euro-global-map-GPKG/DATA/FullEurope/EuroGlobalMap_2026.gpkg',
]

export function openEgm(root) {
  const path = CANDIDATES.map((p) => resolve(root, p)).find((p) => existsSync(p) && statSize(p) > 0)
  if (!path) {
    throw new Error(
      '[europe] EuroGlobalMap not found. Request the GeoPackage at https://www.mapsforeurope.org and extract it into .cache/egm/',
    )
  }
  return { path, db: new DatabaseSync(path, { readOnly: true }) }
}

function statSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Bytes of envelope after the 8-byte header, by the envelope indicator in the flags. */
const ENVELOPE_BYTES = [0, 32, 48, 48, 64]

/**
 * A GeoPackage geometry blob as polygons: `[[outer, ...holes], ...]`, rings closed, `[lon, lat]`.
 * Points and lines come back as `null`; only areas are read.
 */
export function polygonsOfBlob(blob) {
  if (!blob || blob[0] !== 0x47 || blob[1] !== 0x50) throw new Error('not a GeoPackage geometry')
  const flags = blob[3]
  const empty = (flags >> 4) & 1
  if (empty) return []
  const offset = 8 + ENVELOPE_BYTES[(flags >> 1) & 7]
  const view = new DataView(blob.buffer, blob.byteOffset + offset, blob.byteLength - offset)
  let at = 0
  const out = []

  function readGeometry() {
    const le = view.getUint8(at) === 1
    at += 1
    let type = view.getUint32(at, le)
    at += 4
    // ISO WKB: 1000s mean Z, 2000s M, 3000s ZM. EWKB flags too, though GeoPackage uses ISO.
    let dims = 2
    if (type & 0x80000000) dims++
    if (type & 0x40000000) dims++
    type &= 0x0fffffff
    if (type >= 3000) (dims = 4), (type -= 3000)
    else if (type >= 2000) (dims = 3), (type -= 2000)
    else if (type >= 1000) (dims = 3), (type -= 1000)
    const readRing = () => {
      const n = view.getUint32(at, le)
      at += 4
      const ring = new Array(n)
      for (let i = 0; i < n; i++) {
        ring[i] = [view.getFloat64(at, le), view.getFloat64(at + 8, le)]
        at += 8 * dims
      }
      return ring
    }
    if (type === 3) {
      const rings = view.getUint32(at, le)
      at += 4
      const polygon = []
      for (let r = 0; r < rings; r++) polygon.push(readRing())
      out.push(polygon)
    } else if (type === 6 || type === 7) {
      const parts = view.getUint32(at, le)
      at += 4
      for (let p = 0; p < parts; p++) readGeometry()
    } else {
      throw new Error(`unsupported WKB geometry type ${type}`)
    }
  }
  readGeometry()
  return out.map((polygon) => polygon.map(closeRing).filter((ring) => ring.length >= 4)).filter((p) => p.length > 0)
}

function closeRing(ring) {
  const a = ring[0]
  const b = ring[ring.length - 1]
  return a && b && (a[0] !== b[0] || a[1] !== b[1]) ? [...ring, a] : ring
}

/** Every row of a table, with its geometry decoded into `polygons`. */
export function* rows(db, table, where = '1=1') {
  for (const row of db.prepare(`select * from "${table}" where ${where}`).iterate()) {
    const { geom, ...attributes } = row
    yield { ...attributes, polygons: geom ? polygonsOfBlob(geom) : [] }
  }
}

/** A code that is really there: EuroGeographics writes "UNK" or leaves it empty for none. */
export const present = (value) => value !== null && value !== undefined && value !== '' && value !== 'UNK' && value !== 'None'
