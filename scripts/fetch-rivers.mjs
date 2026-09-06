/**
 * Rebuilds the vendored river datasets from Natural Earth.
 *
 * A maintenance script, NOT part of the build: it reaches the network, so it is run by
 * hand when the source data or the relevance threshold changes. `npm run dev` and
 * `npm run build` only ever read the vendored result, so ordinary builds stay offline.
 *
 *   node scripts/fetch-rivers.mjs
 *
 * Source: Natural Earth via github.com/nvkelso/natural-earth-vector — public domain.
 * The layer is `rivers_lake_centerlines`, which is the real surveyed course of each
 * river, including the line it takes through the lakes it passes through.
 *
 * Selection is by Natural Earth's own `scalerank`, the cartographers' judgement of how
 * prominent a river is on a general-purpose map — the same measure the lake layer uses,
 * chosen for the same reason: it is somebody's considered opinion rather than a
 * threshold invented here. The script prints which of the world's major rivers survived
 * the filter, so raising or lowering MAX_SCALERANK can be judged by what it keeps rather
 * than by the count.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_SCALERANK = 6

/** Decimal places kept on coordinates: 4dp is ~11 m, far finer than any screen use. */
const COORD_PRECISION = 4

const SOURCES = [
  {
    detail: '10m',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson',
  },
  {
    detail: '50m',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson',
  },
]

/**
 * The rivers a world map is expected to have. Reported, never used to filter.
 *
 * Under Natural Earth's names, which are not always the English ones: the Yellow River
 * is `Huang`, the Yangtze is `Chang Jiang` and the Amur is `Heilong Jiang`. Checking for
 * "Yellow" reported it missing from a file that contained it.
 */
const EXPECTED = [
  'Nile', 'Amazon', 'Mississippi', 'Danube', 'Chang Jiang', 'Ganges', 'Indus', 'Mekong',
  'Congo', 'Volga', 'Rhine', 'Niger', 'Yenisey', 'Ob', 'Lena', 'Heilong Jiang', 'Paraná',
  'Murray', 'Zambezi', 'Euphrates', 'Tigris', 'Huang', 'Colorado',
  'Rio Grande', 'St. Lawrence', 'Mackenzie', 'Orinoco', 'Brahmaputra', 'Don', 'Elbe',
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
    const { scalerank, name, name_en: nameEn } = feature.properties ?? {}
    if (typeof scalerank !== 'number' || scalerank > MAX_SCALERANK) continue
    if (!feature.geometry) continue

    features.push({
      type: 'Feature',
      /*
       * Only what the renderer and a future labels layer need. The source carries
       * thirty-odd localised name fields and a dozen hydrological codes, which would
       * multiply the file for nothing a map draws.
       */
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
    source: `Natural Earth ne_${detail}_rivers_lake_centerlines (public domain)`,
    filter: `scalerank <= ${MAX_SCALERANK}`,
    features,
  }
  writeFileSync(resolve(outDir, `rivers-${detail}.geojson`), JSON.stringify(out))

  const names = new Set(features.map((f) => f.properties.name).filter(Boolean))
  const missing = EXPECTED.filter(
    (want) => ![...names].some((n) => n.toLowerCase().includes(want.toLowerCase())),
  )
  console.log(
    `[fetch-rivers] ${detail}: ${source.features.length} -> ${features.length} rivers, ` +
      `${(JSON.stringify(out).length / 1024).toFixed(0)}kB -> data/natural-earth/rivers-${detail}.geojson`,
  )
  console.log(
    `[fetch-rivers] ${detail}: ${EXPECTED.length - missing.length}/${EXPECTED.length} major rivers present` +
      (missing.length ? `, missing: ${missing.join(', ')}` : ''),
  )
}
