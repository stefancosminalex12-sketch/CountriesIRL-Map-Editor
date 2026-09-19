/**
 * Which subdivisions each country of Europe Administrative is drawn with.
 *
 * The editorial decision, country by country, and the only place it is made. Not one level
 * everywhere: Slovenia's 212 municipalities and Germany's 16 Länder are both "first level",
 * and a map drawn with both is fragmented in one place and coarse in the other. Each country
 * is drawn at the level that country actually administers and that a reader recognises, from
 * the hierarchy EuroBoundaryMap publishes inside EuroGlobalMap (`SHN1`…`SHN4`, with names and
 * designations in `EBM_NAM` / `EBM_ISN`).
 *
 * Three presets, the Map Detail choices of the Europe Administrative map:
 *
 *   regions   the first-order divisions: French régions, German Länder, Italian regioni
 *   standard  the default: the level each country is known by, as the table below says
 *   detailed  the finest level EuroGlobalMap has where it is still administrative
 *
 * A LEVEL is one of:
 *
 *   { shn: n }    the units of hierarchy level n. An area that has no unit at that level (Vienna
 *                 has no Bezirk, Ceuta no province) is drawn with the nearest level it has,
 *                 coarser first, so no ground is left without a unit.
 *   { nuts3: true } Eurostat's NUTS 3 regions from EuroGlobalMap's own NUTS layer, where they are
 *                 the recognised unit and the administrative hierarchy stops short of it:
 *                 Greece's regional units, Slovenia's statistical regions.
 *   { ne: true }  Natural Earth's admin-1 units (public domain), cut into EuroGlobalMap's outline
 *                 of the country, for the countries EuroGlobalMap describes only as a whole:
 *                 Russia, Belarus, Türkiye, Georgia, Armenia, Azerbaijan, Ireland's counties,
 *                 Montenegro's municipalities.
 *   { whole: true } the country as one unit: the microstates, the Crown dependencies, the
 *                 Faroes and Svalbard, and Luxembourg (whose only open subdivision layer is the
 *                 three districts abolished in 2015).
 *
 * `all` sets one level for every preset. Kosovo is drawn as its own country (EuroGlobalMap's
 * `optionKS` layer), as on the World map.
 */
const L = (n) => ({ shn: n })
const NUTS3 = { nuts3: true }
const NE = { ne: true }
const WHOLE = { whole: true }

export const PRESETS = ['regions', 'standard', 'detailed']

export const PRESET_INFO = {
  regions: {
    label: 'Regions',
    description: 'First-order divisions: French régions, German Länder, Spanish autonomous communities, Polish voivodeships.',
  },
  standard: {
    label: 'Standard',
    description: 'Each country’s own recognised level: départements, Kreise, provinces, powiats, județe, oblasti.',
  },
  detailed: {
    label: 'Detailed',
    description: 'The finest official level available: Bosnia’s municipalities, Belgium’s arrondissements, Slovenia’s municipalities.',
  },
}

/** EuroGlobalMap country code → the editor's country id, and the level each preset draws. */
export const COUNTRIES = {
  AD: { iso3: 'AND', all: WHOLE },
  AL: { iso3: 'ALB', all: L(1), note: 'Counties (qarqe)' },
  AM: { iso3: 'ARM', all: NE },
  AT: { iso3: 'AUT', regions: L(1), standard: L(2), detailed: L(2), note: 'Bezirke and statutory cities' },
  AZ: { iso3: 'AZE', all: NE },
  BA: { iso3: 'BIH', regions: L(1), standard: L(2), detailed: L(3), note: 'The two entities and Brčko; the Federation by canton; municipalities' },
  BE: { iso3: 'BEL', regions: L(1), standard: L(2), detailed: L(3), note: 'Regions, provinces (Brussels as its region), arrondissements' },
  BG: { iso3: 'BGR', all: L(1), note: 'Provinces (oblasti)' },
  BY: { iso3: 'BLR', all: NE },
  CH: { iso3: 'CHE', all: L(1), note: 'Cantons' },
  CY: { iso3: 'CYP', all: L(1), note: 'Districts' },
  CZ: { iso3: 'CZE', regions: L(1), standard: L(2), detailed: L(2), note: 'Kraje; okresy (with Prague)' },
  DE: { iso3: 'DEU', regions: L(1), standard: L(3), detailed: L(3), note: 'Länder; Landkreise and kreisfreie Städte' },
  DK: { iso3: 'DNK', all: L(1), note: 'Regions' },
  EE: { iso3: 'EST', all: L(1), note: 'Counties (maakonnad)' },
  ES: { iso3: 'ESP', regions: L(1), standard: L(2), detailed: L(2), note: 'Autonomous communities; provinces, with Ceuta and Melilla' },
  FI: { iso3: 'FIN', all: L(2), note: 'Regions (maakunnat)' },
  FO: { iso3: 'FRO', all: WHOLE },
  FR: { iso3: 'FRA', regions: L(1), standard: L(2), detailed: L(2), note: 'Régions; départements' },
  GB: { iso3: 'GBR', regions: L(1), standard: L(2), detailed: L(2), note: 'England, Scotland, Wales; counties, unitary authorities, metropolitan districts, council areas' },
  ND: { iso3: 'GBR', regions: L(1), standard: L(3), detailed: L(3), note: 'Northern Ireland; its local government districts' },
  GE: { iso3: 'GEO', all: NE },
  GG: { iso3: 'GGY', all: WHOLE },
  GI: { iso3: 'GIB', all: WHOLE },
  GL: { iso3: 'GRL', all: L(1), note: 'Municipalities' },
  GR: { iso3: 'GRC', regions: L(2), standard: NUTS3, detailed: NUTS3, note: 'Regions (periferies); regional units by NUTS 3' },
  HR: { iso3: 'HRV', all: L(1), note: 'Counties (županije)' },
  HU: { iso3: 'HUN', all: L(2), note: 'Counties (vármegyék) and Budapest' },
  IE: { iso3: 'IRL', regions: L(1), standard: NE, detailed: NE, note: 'Regional assemblies; counties and cities' },
  IM: { iso3: 'IMN', all: WHOLE },
  IS: { iso3: 'ISL', all: L(1), note: 'Municipalities' },
  IT: { iso3: 'ITA', regions: L(1), standard: L(2), detailed: L(2), note: 'Regioni; province and città metropolitane' },
  JE: { iso3: 'JEY', all: WHOLE },
  KS: { iso3: 'XKX', all: L(2), note: 'Municipalities' },
  LI: { iso3: 'LIE', all: WHOLE },
  LT: { iso3: 'LTU', regions: L(1), standard: L(2), detailed: L(2), note: 'Counties; municipalities' },
  LU: { iso3: 'LUX', all: WHOLE },
  LV: { iso3: 'LVA', all: L(1), note: 'Municipalities and state cities' },
  MC: { iso3: 'MCO', all: WHOLE },
  MD: { iso3: 'MDA', all: L(1), note: 'Districts, municipalities, Gagauzia and Transnistria' },
  ME: { iso3: 'MNE', all: NE },
  MK: { iso3: 'MKD', all: L(1), note: 'Municipalities' },
  MT: { iso3: 'MLT', all: L(1), note: 'Local councils' },
  NL: { iso3: 'NLD', all: L(1), note: 'Provinces' },
  NO: { iso3: 'NOR', all: L(1), note: 'Counties (fylker)' },
  PL: { iso3: 'POL', regions: L(1), standard: L(2), detailed: L(2), note: 'Voivodeships; powiats' },
  PT: { iso3: 'PRT', all: L(2), note: 'Districts and the islands of the Azores and Madeira' },
  RO: { iso3: 'ROU', all: L(1), note: 'Counties (județe) and Bucharest' },
  RS: { iso3: 'SRB', all: L(2), note: 'Districts (okruzi) and Belgrade' },
  RU: { iso3: 'RUS', all: NE },
  SE: { iso3: 'SWE', all: L(1), note: 'Counties (län)' },
  SI: { iso3: 'SVN', regions: NUTS3, standard: NUTS3, detailed: L(1), note: 'Statistical regions; municipalities' },
  SJ: { iso3: 'SJM', all: WHOLE },
  SK: { iso3: 'SVK', regions: L(1), standard: L(2), detailed: L(2), note: 'Kraje; okresy' },
  SM: { iso3: 'SMR', all: WHOLE },
  TR: { iso3: 'TUR', all: NE },
  UA: { iso3: 'UKR', all: L(1), note: 'Oblasts, Crimea, Kyiv and Sevastopol (EuroGlobalMap’s raions predate the 2020 reform)' },
  VA: { iso3: 'VAT', all: WHOLE },
}

export const levelOf = (icc, preset) => {
  const entry = COUNTRIES[icc]
  if (!entry) return WHOLE
  return entry.all ?? entry[preset] ?? WHOLE
}

/** Designations EuroBoundaryMap gives water, not land: lakes held as units of their own. */
export const WATER_DESIGNATIONS = new Set(['Liqen', 'Ezero', 'Zaednichki objekti'])
