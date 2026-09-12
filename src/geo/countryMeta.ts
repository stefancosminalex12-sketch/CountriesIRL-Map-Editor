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
  parent?: { id: string; name: string; iso2: string | null }
  /** What the source calls this kind of subdivision: State, Province, Region, County. */
  kind?: string | null
  /** The source's own identifiers, so an entity can always be traced back to its row. */
  source?: {
    adm1Code: string
    neId: number | null
    iso31662: string | null
    hasc: string | null
    wikidata: string | null
  }
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

/** Fetches and caches one atlas's entity table. */
export function loadEntityMeta(url: string): Promise<EntityMetaIndex> {
  const existing = cache.get(url)
  if (existing) return existing

  const promise = fetch(`${import.meta.env.BASE_URL}${url}`).then(async (r) => {
    if (!r.ok) throw new Error(`Failed to load entity metadata "${url}" (${r.status})`)
    const raw = (await r.json()) as EntityMetaIndex & { countries?: Record<string, EntityMeta> }
    return {
      numericToId: raw.numericToId ?? {},
      nameToId: raw.nameToId ?? {},
      // `countries` is the field the world table used before atlases existed.
      entities: raw.entities ?? raw.countries ?? {},
    }
  })

  cache.set(url, promise)
  return promise
}
