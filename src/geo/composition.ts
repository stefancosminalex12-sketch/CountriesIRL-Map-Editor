/**
 * A dataset assembled from a base and per-country fragments.
 *
 * The Modern Administrative World is drawn at three levels of detail, and most countries
 * look the same at all three. So the build (`scripts/admin/build-admin.mjs`) writes the
 * curated map once, as the base, and each country that another level changes as a fragment
 * of its own: that country's units, their entity rows, and the arcs they add. Opening a
 * level fetches the base — shared, and fetched once however many levels are opened — and
 * the fragments that level lists, and nothing else.
 *
 * Every level was built into one topology before it was split, so a fragment's outline is
 * made of base arcs. Swapping a country's units for a fragment's therefore leaves its coast
 * and its borders with its neighbours untouched, and the result is an ordinary topology to
 * everything downstream: borders, coastlines, merging and hit-testing cannot tell a composed
 * map from one that was built whole.
 *
 * Nothing here knows what a subdivision is. A future dataset — a historical period drawn as
 * a base with a few countries changed — composes the same way.
 */
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification'
import { loadEntityMeta, type EntityMeta, type EntityMetaIndex } from './countryMeta'

export type DetailPreset = 'curated' | 'detailed' | 'maximum'

export interface CompositionIndex {
  generatedAt: string
  /** How many arcs the base has; a fragment's own arcs are numbered from here. */
  baseArcs: number
  presets: Record<DetailPreset, { label: string }>
  countries: Record<
    string,
    {
      name: string
      note?: string
      levels: Record<
        string,
        {
          name: string
          kind: string | null
          adminLevel: string | null
          vintage: number | null
          units: number
          credits: string[]
        }
      >
    } & Record<DetailPreset, string>
  >
  fragments: Record<string, { file: string; units: number }>
  sources: {
    id: string
    name: string
    agency: string
    licence: string
    year: number | null
    url: string
    via: string | null
    countries: string[]
  }[]
}

interface Fragment {
  country: string
  level: string
  baseArcs: number
  arcs: Topology['arcs']
  geometries: GeometryObject[]
  entities: Record<string, EntityMeta>
}

const jsonCache = new Map<string, Promise<unknown>>()

/** One file, fetched and parsed once per session however many datasets ask for it. */
function fetchJson<T>(url: string): Promise<T> {
  const existing = jsonCache.get(url)
  if (existing) return existing as Promise<T>
  const promise = fetch(`${import.meta.env.BASE_URL}${url}`).then((r) => {
    if (!r.ok) throw new Error(`Failed to load "${url}" (${r.status})`)
    return r.json()
  })
  // A failed request is not remembered, so the next attempt tries again.
  promise.catch(() => jsonCache.delete(url))
  jsonCache.set(url, promise)
  return promise as Promise<T>
}

export function fetchTopology(url: string): Promise<Topology> {
  return fetchJson<Topology>(url)
}

export function loadCompositionIndex(url: string): Promise<CompositionIndex> {
  return fetchJson<CompositionIndex>(url)
}

/** The folder a file is in, as a prefix for its siblings. */
const folderOf = (url: string) => url.slice(0, url.lastIndexOf('/') + 1)

/** Which fragment files a preset uses: one per country whose level there is not the base's. */
export function fragmentsFor(index: CompositionIndex, preset: DetailPreset): string[] {
  const files: string[] = []
  for (const [country, entry] of Object.entries(index.countries)) {
    const level = entry[preset]
    if (level === entry.curated) continue
    const fragment = index.fragments[`${country}~${level}`]
    if (fragment) files.push(fragment.file)
  }
  return files
}

/**
 * The base with each fragment's country swapped in.
 *
 * The base object is left as it was — it is cached and shared by every level — and the
 * result is a new topology whose arc list is the base's followed by each fragment's own.
 */
export async function loadComposed(spec: {
  url: string
  metaUrl: string
  objectName: string
  compose: { index: string; preset: DetailPreset }
}): Promise<{ topology: Topology; metaIndex: EntityMetaIndex; index: CompositionIndex }> {
  const [base, baseMeta, index] = await Promise.all([
    fetchTopology(spec.url),
    loadEntityMeta(spec.metaUrl),
    loadCompositionIndex(spec.compose.index),
  ])
  const files = fragmentsFor(index, spec.compose.preset)
  const folder = folderOf(spec.compose.index)
  const fragments = await Promise.all(files.map((file) => fetchJson<Fragment>(`${folder}${file}`)))

  const replaced = new Set(fragments.map((f) => f.country))
  const entities: Record<string, EntityMeta> = {}
  for (const [id, meta] of Object.entries(baseMeta.entities)) {
    if (!replaced.has(meta.parent?.id ?? '')) entities[id] = meta
  }

  const object = base.objects[spec.objectName] as GeometryCollection
  const geometries: GeometryObject[] = object.geometries.filter(
    (g) => !replaced.has(baseMeta.entities[String(g.id)]?.parent?.id ?? ''),
  )
  const arcs = base.arcs.slice()
  for (const fragment of fragments) {
    if (fragment.baseArcs !== base.arcs.length) {
      throw new Error(`Fragment ${fragment.country}.${fragment.level} was built against another base`)
    }
    const start = arcs.length
    const n = fragment.baseArcs
    for (const arc of fragment.arcs) arcs.push(arc)
    const at = (i: number) => (i < n ? i : start + (i - n))
    const remap = (a: unknown): unknown =>
      typeof a === 'number' ? (a < 0 ? ~at(~a) : at(a)) : (a as unknown[]).map(remap)
    for (const g of fragment.geometries) {
      geometries.push({ ...g, arcs: remap((g as { arcs: unknown }).arcs) } as GeometryObject)
    }
    Object.assign(entities, fragment.entities)
  }

  return {
    topology: {
      ...base,
      arcs,
      objects: { ...base.objects, [spec.objectName]: { type: 'GeometryCollection', geometries } },
    },
    metaIndex: { numericToId: {}, nameToId: {}, entities },
    index,
  }
}
