/**
 * Where the administrative engine's finer boundaries come from, and the terms they come under.
 *
 * Natural Earth is the base of every level (see `build-admin.mjs`). The other source is
 * geoBoundaries' gbOpen release (William & Mary geoLab, geoboundaries.org): per-country
 * administrative boundaries republished from national and international agencies under
 * licences that permit commercial use. Each layer's own source agency, licence and year come
 * from geoBoundaries' catalogue and travel with every unit built from it, so the credit in
 * the app is the layer's real one — BKG's for Germany, IGN's for France — not a blanket line.
 *
 * Downloads are cached in `.cache/gb/` like Natural Earth's, so a rebuild is offline;
 * `--refresh` fetches them again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CATALOGUE = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/'

/**
 * Licences whose geometry may be redistributed as part of the map with attribution only.
 * Share-alike licences (ODbL, CC BY-SA) are not used for geometry: the map's data files
 * would then have to carry that licence too. A layer under one of them can still decide
 * which unit a Natural Earth unit belongs to — a fact, not a copy of the geometry.
 */
const ATTRIBUTION_ONLY = [
  /public domain/i,
  /cc0/i,
  /creative commons attribution (2|3|4)\.0 international/i,
  /creative commons attribution (2|3|4)(\.0)?(?! ?-? ?share)/i,
  /open government licen[cs]e/i,
  /data license germany/i,
  /etalab/i,
  /open government canada/i,
  /federal office of topography/i,
]

export function attributionOnly(licence) {
  if (!licence) return false
  if (/share|sa\b|odbl|open database/i.test(licence)) return false
  return ATTRIBUTION_ONLY.some((pattern) => pattern.test(licence))
}

export function createSources(root, { refresh = false } = {}) {
  const cacheDir = resolve(root, '.cache/gb')
  mkdirSync(cacheDir, { recursive: true })
  let catalogue = null

  async function loadCatalogue() {
    if (catalogue) return catalogue
    const path = resolve(cacheDir, 'catalogue.json')
    if (!existsSync(path) || refresh) {
      console.log('[admin] fetching the geoBoundaries catalogue')
      const response = await fetch(CATALOGUE)
      if (!response.ok) throw new Error(`geoBoundaries catalogue -> ${response.status}`)
      writeFileSync(path, await response.text())
    }
    catalogue = JSON.parse(readFileSync(path, 'utf8'))
    return catalogue
  }

  /**
   * One geoBoundaries layer: its features and its credit.
   *
   * The simplified release, which is generalised for display at about the scale Natural
   * Earth's 10m layers are drawn at; the full-resolution one would add hundreds of
   * thousands of internal vertices no one could see on a world map.
   */
  async function geoBoundaries(iso, level) {
    const entry = (await loadCatalogue()).find((row) => row.boundaryISO === iso && row.boundaryType === level)
    if (!entry) throw new Error(`[admin] geoBoundaries has no ${iso} ${level}`)
    const path = resolve(cacheDir, `${iso}-${level}-s.geojson`)
    if (!existsSync(path) || refresh) {
      console.log(`[admin] fetching geoBoundaries ${iso} ${level}`)
      const response = await fetch(entry.simplifiedGeometryGeoJSON)
      if (!response.ok) throw new Error(`geoBoundaries ${iso} ${level} -> ${response.status}`)
      writeFileSync(path, await response.text())
    }
    const collection = JSON.parse(readFileSync(path, 'utf8'))
    return {
      id: `geoboundaries:${iso}:${level}`,
      dataset: `geoBoundaries ${iso} ${level}`,
      credit: {
        name: `geoBoundaries ${iso} ${level} — ${entry.boundaryCanonical && entry.boundaryCanonical !== 'Unknown' ? entry.boundaryCanonical : level}`,
        agency: entry.boundarySource,
        licence: entry.boundaryLicense,
        year: Number(entry.boundaryYearRepresented) || null,
        url: 'https://www.geoboundaries.org',
        via: 'geoBoundaries gbOpen (Runfola et al. 2020, PLoS ONE 15(4): e0231866)',
      },
      attributionOnly: attributionOnly(entry.boundaryLicense),
      features: collection.features.filter((f) => f.geometry),
    }
  }

  return { geoBoundaries }
}

export const NATURAL_EARTH_CREDIT = {
  name: 'Natural Earth 10m admin-1 states and provinces',
  agency: 'Natural Earth',
  licence: 'Public domain',
  year: null,
  url: 'https://www.naturalearthdata.com',
}
