/**
 * Rebuilds the vendored lake datasets from Natural Earth.
 *
 * This is a maintenance script, NOT part of the build: it reaches the network, so it
 * is run by hand when the source data or the relevance threshold needs to change.
 * `npm run dev` / `npm run build` only ever read the vendored result, so ordinary
 * builds stay entirely offline.
 *
 *   node scripts/fetch-lakes.mjs
 *
 * Source: Natural Earth via github.com/nvkelso/natural-earth-vector — public domain.
 *
 * Selection is by Natural Earth's own `scalerank`, which is the cartographers'
 * judgement of how prominent a lake is on a general-purpose map. Rank 5 and below
 * keeps 336 of the 1,355 lakes in the 10m file: every major lake in the world,
 * including small-but-notable ones like Geneva and Bodensee, without dragging in a
 * thousand ponds. Raise MAX_SCALERANK to include more.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_SCALERANK = 5

/** Decimal places kept on coordinates: 4dp is ~11 m, far finer than any screen use. */
const COORD_PRECISION = 4

const SOURCES = [
  { detail: '10m', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson' },
  { detail: '50m', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson' },
]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'data/natural-earth')
mkdirSync(outDir, { recursive: true })

const round = (n) => Number(n.toFixed(COORD_PRECISION))

function roundCoords(coords) {
  if (typeof coords[0] === 'number') return [round(coords[0]), round(coords[1])]
  return coords.map(roundCoords)
}

for (const { detail, url } of SOURCES) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  const source = await response.json()

  const features = []
  for (const feature of source.features) {
    const { scalerank, name, name_en: nameEn } = feature.properties
    if (typeof scalerank !== 'number' || scalerank > MAX_SCALERANK) continue
    if (!feature.geometry) continue

    features.push({
      type: 'Feature',
      // Only what the renderer and a future labels layer need; the source carries
      // 30+ localised name fields that would triple the file for no benefit.
      properties: {
        name: name ?? nameEn ?? null,
        scalerank,
      },
      geometry: {
        type: feature.geometry.type,
        coordinates: roundCoords(feature.geometry.coordinates),
      },
    })
  }

  features.sort((a, b) => (a.properties.name ?? '').localeCompare(b.properties.name ?? ''))

  const out = {
    type: 'FeatureCollection',
    source: 'Natural Earth ne_' + detail + '_lakes (public domain)',
    filter: `scalerank <= ${MAX_SCALERANK}`,
    features,
  }
  const path = resolve(outDir, `lakes-${detail}.geojson`)
  writeFileSync(path, JSON.stringify(out))
  console.log(
    `[fetch-lakes] ${detail}: ${source.features.length} -> ${features.length} lakes, ` +
      `${(JSON.stringify(out).length / 1024).toFixed(0)}kB -> data/natural-earth/lakes-${detail}.geojson`,
  )
}
