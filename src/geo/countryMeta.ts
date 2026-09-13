/**
 * Loader for a generated entity table (see scripts/prepare-data.mjs).
 *
 * One table shape for every atlas. A country and a state are both *entities* with an id,
 * a name, a short code and a place in a hierarchy, and the difference between them is
 * which values those fields carry — not which fields exist. Keeping one shape is what
 * lets the inspector, the pickers and the legend read an entity without asking what kind
 * of map is open.
 */

export interface EntityMeta {
  id: string
  /**
   * The ISO 3166-1 alpha-2 code, when the entity is a country.
   *
   * `null` for anything that is not one. This field exists for exactly one purpose —
   * it is the key the flag library is indexed on — so a state carries null here rather
   * than a stand-in that would ask for artwork that does not exist. The entity's own
   * short identifier is {@link code}.
   */
  iso2: string | null
  /**
   * The entity's own short code: `US` for the United States, `CA` for California.
   *
   * What a reader would recognise on a map key. Distinct from `iso2` because for a
   * country the two coincide and for everything else they do not.
   */
  code: string
  numeric: string | null
  name: string
  officialName: string
  /** The top level of whatever hierarchy this atlas uses: a continent, a census region. */
  region: string
  /** The level below it: an ISO subregion, a census division. */
  subregion: string
  independent: boolean
  lat: number
  lng: number
  /**
   * The country a subdivision belongs to, by the world map's own id for it.
   *
   * Absent on a country, and on a state of the states map, whose atlas is one country.
   * Present on every entity of the administrative world, where it is what tells a border
   * between two countries from one inside a country, and what region a subdivision is in.
   */
  parent?: {
    id: string
    name: string
    iso2: string | null
    /** What the parent is — "State", "Territory" — where it is not a country. */
    kind?: string
    /** Its short code: `CA`. */
    code?: string
  }
  /** What this kind of subdivision is called: State, Province, Statistical region, County. */
  kind?: string | null
  /** The level of its country's subdivision this unit belongs to — "Statistical regions". */
  level?: { id: string; name: string }
  /**
   * The regions this unit can be selected with: its autonomous community, the coarser
   * levels of its own country that hold it, a historical region. See {@link EntityGroup}.
   */
  groups?: EntityGroup[]
  /** Where the unit was dissolved from several source units, their names. */
  members?: string[]
  /** Where the unit comes from, so an entity can always be traced back to its rows. */
  source?: {
    /** The dataset its outline comes from, or its internal lines where `outline` is set. */
    dataset: string
    /** The source rows it was made from. */
    ids: string[]
    /** Where the unit's outline is another dataset's — a cut into Natural Earth's unit. */
    outline?: string
    /** Where membership of a dissolved unit was read from another dataset. */
    grouping?: string | null
    iso31662: string | null
    hasc: string | null
    wikidata: string | null
    /** Ids into the composition index's `sources`. */
    credits?: string[]
    /** The official identifier, where the source has one: a Census GEOID (`06037`). */
    geoid?: string
    /** The year the boundaries represent. */
    vintage?: number
    /** The source's own codes, by the source's field names: `STATEFP`, `COUNTYFP`, `LSAD`. */
    codes?: Record<string, string>
    landKm2?: number
    waterKm2?: number
  }
}

/**
 * A region a unit lies in, which is not itself a unit on the map at this level.
 *
 * Catalonia on a map of Spanish provinces, Upper Bavaria on a map of Kreise, Transylvania on
 * a map of Romanian counties. Metadata rather than geometry: selecting a group selects the
 * units that carry it, and nothing is drawn that the level does not draw.
 */
export interface EntityGroup {
  /** What kind of region: "Autonomous community", "Government district". */
  scheme: string
  /** Stable, and shared by every unit of the group at this level. */
  id: string
  name: string
  /** A region only approximated by the units — historical regions drawn by county. */
  approximate?: boolean
  /** Set where the group is a unit of another level of the same country. */
  level?: string
}

/** Kept as the old name so the country-shaped call sites read naturally. */
export type CountryMeta = EntityMeta

export interface EntityMetaIndex {
  /** ISO 3166-1 numeric -> id. Empty for atlases whose features carry their own id. */
  numericToId: Record<string, string>
  /** Source feature name -> id, for entities without a numeric code. */
  nameToId: Record<string, string>
  entities: Record<string, EntityMeta>
}

export type CountryMetaIndex = EntityMetaIndex

const cache = new Map<string, Promise<EntityMetaIndex>>()

/** A parent as a compact table lists it once: what its units would otherwise each repeat. */
interface CompactParent {
  id: string
  name: string
  iso2: string | null
  kind?: string
  code?: string
  region?: string
  subregion?: string
  groups?: EntityGroup[]
}

/**
 * A compact entity table made whole: each entity names its parent and its groups by id, and
 * takes what every entity shares from `defaults`. Written this way by a dataset of tens of
 * thousands of units (the official USA map's county subdivisions); everything downstream sees
 * ordinary entries.
 */
function expand(
  entities: Record<string, EntityMeta>,
  defaults: Partial<EntityMeta>,
  parents: Record<string, CompactParent>,
  groups: Record<string, EntityGroup>,
): Record<string, EntityMeta> {
  const out: Record<string, EntityMeta> = {}
  for (const [id, raw] of Object.entries(entities)) {
    const entry = raw as EntityMeta & { parent?: string | EntityMeta['parent']; groups?: (string | EntityGroup)[] }
    const parent = typeof entry.parent === 'string' ? parents[entry.parent] : undefined
    const own = (entry.groups ?? []).map((g) => (typeof g === 'string' ? groups[g] : g)).filter((g): g is EntityGroup => !!g)
    out[id] = {
      ...defaults,
      ...entry,
      id,
      officialName: entry.officialName ?? entry.name,
      region: entry.region ?? parent?.region ?? 'Unknown',
      subregion: entry.subregion ?? parent?.subregion ?? 'Unknown',
      parent: parent
        ? { id: parent.id, name: parent.name, iso2: parent.iso2, kind: parent.kind, code: parent.code }
        : (entry.parent as EntityMeta['parent']),
      groups: [...own, ...(parent?.groups ?? [])],
    } as EntityMeta
  }
  return out
}

/** Fetches and caches one atlas's entity table. */
export function loadEntityMeta(url: string): Promise<EntityMetaIndex> {
  const existing = cache.get(url)
  if (existing) return existing

  const promise = fetch(`${import.meta.env.BASE_URL}${url}`).then(async (r) => {
    if (!r.ok) throw new Error(`Failed to load entity metadata "${url}" (${r.status})`)
    const raw = (await r.json()) as EntityMetaIndex & {
      countries?: Record<string, EntityMeta>
      defaults?: Partial<EntityMeta>
      parents?: Record<string, CompactParent>
      groups?: Record<string, EntityGroup>
    }
    // `countries` is the field the world table used before atlases existed.
    const entities = raw.entities ?? raw.countries ?? {}
    return {
      numericToId: raw.numericToId ?? {},
      nameToId: raw.nameToId ?? {},
      entities: raw.parents || raw.defaults || raw.groups ? expand(entities, raw.defaults ?? {}, raw.parents ?? {}, raw.groups ?? {}) : entities,
    }
  })

  cache.set(url, promise)
  return promise
}
