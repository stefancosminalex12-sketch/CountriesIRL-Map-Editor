/**
 * Subregions: named parts of each continent, offered under it in the region selector.
 *
 * They are framing presets and nothing else. Choosing one moves the camera to its geography
 * and marks what is inside it, exactly as choosing a continent does. It creates no dataset,
 * no group and no merge, and the map's geometry is untouched.
 *
 * **Every entry states its definition**, and the definitions follow one rule each:
 *
 * - **Compass-point regions** (Western Europe, East Africa, Central America, Micronesia…) are
 *   the UN M49 geoscheme's subregions, as published by the UN Statistics Division. Where this
 *   editor's own entities are finer than M49's (Kosovo, Northern Cyprus, Somaliland, the
 *   disputed specks), they sit where their surroundings sit.
 * - **Physical regions** (peninsulas, archipelagos, basins, mountain ranges) are the
 *   countries on them. When a feature covers only part of its countries, a `domain` box
 *   gives the feature's own extent: the Alps, the Carpathians, the Amazon basin, the Gran
 *   Chaco, the Sahel belt and the Coral Sea.
 * - **Parts of countries** (New England, Siberia, Patagonia, Brazil's macro-regions) are
 *   listed by the ISO 3166-2 codes of their states, provinces or regions, following the
 *   authority that defines them: the US Census Bureau, the IBGE, Russia's federal districts
 *   and economic regions. The world maps draw whole countries, so these parts cannot be
 *   drawn on their own. Instead, the camera frames only the real extent of the listed
 *   units, measured from Natural Earth's admin-1 boundaries by
 *   `scripts/build-subregion-parts.mjs` into `subregionParts.json`. The country is still
 *   drawn whole, and the rest of it is simply outside the frame.
 *
 * Overlap is expected and harmless. Scandinavia sits inside the Nordic countries, and
 * Indochina inside Mainland Southeast Asia. Each preset is a way to frame the map, not a
 * partition of it.
 *
 * Adding one is adding an entry to its continent's list, and, if it names ISO 3166-2 codes,
 * re-running the build script.
 */
import type { BBox, ExcludedArea } from './regions'

export type ContinentId = 'europe' | 'asia' | 'africa' | 'north-america' | 'south-america' | 'oceania'

export interface SubregionDef {
  /** Stable slug, unique within its continent. The region id is `continent/slug`. */
  slug: string
  name: string
  /** The definition used, in one line. Shown as the chip's tooltip. */
  definition: string
  /** Countries and territories belonging whole, by this editor's entity ids (ISO 3166-1 alpha-3). */
  countries?: string[]
  /**
   * Countries that belong only in part: country id → the ISO 3166-2 codes of the units that
   * make up the part. The camera frames only those units' extent within the country.
   */
  parts?: Record<string, string[]>
  /**
   * The physical feature's own extent, [west, south, east, north], for a region defined by
   * geography rather than borders. Only the members' geometry inside it is framed.
   * Without it, the continent's own framing domain applies.
   */
  domain?: BBox
  /**
   * Areas carved out of the members. Without it, the continent's own list applies (Europe's
   * Svalbard, the Azores, the Canaries…).
   */
  excludedAreas?: ExcludedArea[]
}

/* The M49 lists, shared where one region is built from another. */
const BALKANS = ['ALB', 'BIH', 'BGR', 'HRV', 'XKX', 'UNK', 'MNE', 'MKD', 'SRB']
const IBERIA = ['ESP', 'PRT', 'AND', 'GIB']
const MELANESIA = ['FJI', 'NCL', 'PNG', 'SLB', 'VUT']
const POLYNESIA = ['ASM', 'COK', 'NIU', 'PCN', 'PYF', 'TKL', 'TON', 'TUV', 'WLF', 'WSM']
const TRANSCAUCASIA = ['GEO', 'ARM', 'AZE']

/** Russia's Asian federal districts, by ISO 3166-2 code. */
const RU_URALS = ['RU-KGN', 'RU-SVE', 'RU-TYU', 'RU-KHM', 'RU-YAN', 'RU-CHE']
const RU_WEST_SIBERIA = ['RU-ALT', 'RU-AL', 'RU-KEM', 'RU-NVS', 'RU-OMS', 'RU-TOM', 'RU-TYU', 'RU-KHM', 'RU-YAN']
const RU_EAST_SIBERIA = ['RU-BU', 'RU-TY', 'RU-KK', 'RU-KYA', 'RU-IRK', 'RU-ZAB']
const RU_SIBERIAN_FD = ['RU-AL', 'RU-ALT', 'RU-IRK', 'RU-KEM', 'RU-KYA', 'RU-KK', 'RU-NVS', 'RU-OMS', 'RU-TOM', 'RU-TY']
const RU_FAR_EAST = ['RU-AMU', 'RU-BU', 'RU-CHU', 'RU-KAM', 'RU-KHA', 'RU-MAG', 'RU-PRI', 'RU-SA', 'RU-SAK', 'RU-YEV', 'RU-ZAB']

/** Türkiye's 81 provinces (TR-01…TR-81) without the three wholly in Thrace. */
const ANATOLIA = Array.from({ length: 81 }, (_, i) => `TR-${String(i + 1).padStart(2, '0')}`).filter(
  (code) => !['TR-22', 'TR-39', 'TR-59'].includes(code),
)

const us = (...states: string[]) => states.map((s) => `US-${s}`)
const ca = (...provinces: string[]) => provinces.map((p) => `CA-${p}`)
const br = (...states: string[]) => states.map((s) => `BR-${s}`)

export const SUBREGIONS: Record<ContinentId, SubregionDef[]> = {
  /* ------------------------------------------------------------------ Europe */
  europe: [
    { slug: 'western', name: 'Western Europe', definition: 'UN M49 Western Europe', countries: ['AUT', 'BEL', 'FRA', 'DEU', 'LIE', 'LUX', 'MCO', 'NLD', 'CHE'] },
    { slug: 'central', name: 'Central Europe', definition: 'Austria, Czechia, Germany, Hungary, Liechtenstein, Poland, Slovakia, Slovenia and Switzerland', countries: ['AUT', 'CZE', 'DEU', 'HUN', 'LIE', 'POL', 'SVK', 'SVN', 'CHE'] },
    { slug: 'eastern', name: 'Eastern Europe', definition: 'UN M49 Eastern Europe; Russia as far as the continent’s framing reaches (50°E)', countries: ['BLR', 'BGR', 'CZE', 'HUN', 'MDA', 'POL', 'ROU', 'RUS', 'SVK', 'UKR'] },
    {
      slug: 'northern',
      name: 'Northern Europe',
      definition: 'UN M49 Northern Europe, Iceland included; Svalbard and Jan Mayen left out, as on the map of Europe',
      countries: ['ALA', 'DNK', 'EST', 'FRO', 'FIN', 'GGY', 'ISL', 'IRL', 'IMN', 'JEY', 'LVA', 'LTU', 'NOR', 'SWE', 'GBR'],
      domain: [-25, 49, 45, 72],
    },
    { slug: 'southern', name: 'Southern Europe', definition: 'UN M49 Southern Europe', countries: ['ALB', 'AND', 'BIH', 'HRV', 'GIB', 'GRC', 'VAT', 'ITA', 'MLT', 'MNE', 'MKD', 'PRT', 'SMR', 'SRB', 'SVN', 'ESP', 'XKX', 'UNK'] },
    { slug: 'southeastern', name: 'Southeastern Europe', definition: 'The Balkan states, Greece, Romania, Moldova and Slovenia', countries: [...BALKANS, 'GRC', 'ROU', 'MDA', 'SVN'] },
    {
      slug: 'southwestern',
      name: 'Southwestern Europe',
      definition: 'The Iberian Peninsula with Andorra and Gibraltar, and France’s south-west (Nouvelle-Aquitaine, Occitanie)',
      countries: IBERIA,
      parts: { FRA: ['FR-NAQ', 'FR-OCC'] },
    },
    { slug: 'balkans', name: 'Balkans', definition: 'The peninsula’s states north of Greece: Albania, Bosnia and Herzegovina, Bulgaria, Croatia, Kosovo, Montenegro, North Macedonia, Serbia', countries: BALKANS },
    { slug: 'balkans-greece', name: 'Balkans and Greece', definition: 'The Balkans, with Greece', countries: [...BALKANS, 'GRC'] },
    { slug: 'baltic', name: 'Baltic States', definition: 'Estonia, Latvia, Lithuania', countries: ['EST', 'LVA', 'LTU'] },
    { slug: 'benelux', name: 'Benelux', definition: 'Belgium, the Netherlands, Luxembourg', countries: ['BEL', 'NLD', 'LUX'] },
    { slug: 'british-isles', name: 'British Isles', definition: 'Great Britain, Ireland, the Isle of Man and the Channel Islands', countries: ['GBR', 'IRL', 'IMN', 'GGY', 'JEY'] },
    { slug: 'iberian', name: 'Iberian Peninsula', definition: 'Spain, Portugal, Andorra, Gibraltar; the Canaries, Azores and Madeira left out, as on the map of Europe', countries: IBERIA },
    { slug: 'italian', name: 'Italian Peninsula', definition: 'Italy with Sicily and Sardinia, San Marino, Vatican City', countries: ['ITA', 'SMR', 'VAT'] },
    { slug: 'scandinavian-peninsula', name: 'Scandinavian Peninsula', definition: 'Norway and Sweden', countries: ['NOR', 'SWE'] },
    { slug: 'scandinavia', name: 'Scandinavia', definition: 'Denmark, Norway, Sweden', countries: ['DNK', 'NOR', 'SWE'] },
    {
      slug: 'nordic',
      name: 'Nordic Countries',
      definition: 'The Nordic Council’s members: Denmark, Finland, Iceland, Norway, Sweden, with the Faroes, Greenland and Åland',
      countries: ['DNK', 'FIN', 'ISL', 'NOR', 'SWE', 'FRO', 'GRL', 'ALA'],
      domain: [-75, 54, 45, 84],
      excludedAreas: [{ name: 'Bouvet Island', bbox: [2, -55.5, 5, -53.5] }],
    },
    {
      slug: 'mediterranean',
      name: 'European Mediterranean',
      definition: 'The European states with a Mediterranean coast, Cyprus included, plus the microstates within them; Türkiye is with Asia',
      countries: ['ESP', 'GIB', 'FRA', 'MCO', 'ITA', 'SMR', 'VAT', 'MLT', 'SVN', 'HRV', 'BIH', 'MNE', 'ALB', 'GRC', 'CYP', 'XNC', 'XAK', 'XDH', 'XCB'],
    },
    {
      slug: 'carpathian',
      name: 'Carpathian Region',
      definition: 'The Carpathian Convention’s states, framed on the mountain arc from Bratislava to the Iron Gates',
      countries: ['CZE', 'SVK', 'POL', 'HUN', 'UKR', 'ROU', 'SRB'],
      domain: [16.8, 43.5, 27.5, 50.3],
    },
    {
      slug: 'alpine',
      name: 'Alpine Region',
      definition: 'The Alpine Convention’s states, framed on the Convention’s perimeter around the Alps',
      countries: ['AUT', 'CHE', 'DEU', 'FRA', 'ITA', 'LIE', 'MCO', 'SVN'],
      domain: [4.9, 43.6, 16.2, 48.3],
    },
    {
      slug: 'adriatic',
      name: 'Adriatic Region',
      definition: 'The states on the Adriatic: Slovenia, Croatia, Bosnia and Herzegovina, Montenegro, Albania, and Italy’s Adriatic regions from Friuli to Apulia',
      countries: ['SVN', 'HRV', 'BIH', 'MNE', 'ALB'],
      parts: { ITA: ['IT-36', 'IT-34', 'IT-45', 'IT-57', 'IT-65', 'IT-67', 'IT-75'] },
    },
    {
      slug: 'black-sea',
      name: 'Black Sea Region',
      definition: 'The six littoral states: Bulgaria, Romania, Ukraine, Georgia, Türkiye, and Russia by its Black Sea coast (Krasnodar Krai)',
      countries: ['BGR', 'ROU', 'UKR', 'GEO', 'TUR'],
      parts: { RUS: ['RU-KDA'] },
    },
  ],

  /* -------------------------------------------------------------------- Asia */
  asia: [
    { slug: 'east', name: 'East Asia', definition: 'UN M49 Eastern Asia', countries: ['CHN', 'HKG', 'MAC', 'JPN', 'PRK', 'KOR', 'MNG', 'TWN'] },
    { slug: 'southeast', name: 'Southeast Asia', definition: 'UN M49 South-eastern Asia', countries: ['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'TLS', 'VNM', 'XSP', 'XSR'] },
    { slug: 'south', name: 'South Asia', definition: 'The eight SAARC states: Afghanistan, Bangladesh, Bhutan, India, the Maldives, Nepal, Pakistan, Sri Lanka', countries: ['AFG', 'BGD', 'BTN', 'IND', 'MDV', 'NPL', 'PAK', 'LKA', 'XSI'] },
    { slug: 'central', name: 'Central Asia', definition: 'UN M49 Central Asia', countries: ['KAZ', 'KGZ', 'TJK', 'TKM', 'UZB', 'XBK'] },
    { slug: 'north', name: 'North Asia', definition: 'Asian Russia: the Urals, Siberian and Far Eastern federal districts', parts: { RUS: [...new Set([...RU_URALS, ...RU_SIBERIAN_FD, ...RU_FAR_EAST])] } },
    {
      slug: 'middle-east',
      name: 'Middle East',
      definition: 'The Gulf states, Iran, Iraq, the Levant, Cyprus, Türkiye and Egypt',
      countries: ['BHR', 'CYP', 'EGY', 'IRN', 'IRQ', 'ISR', 'JOR', 'KWT', 'LBN', 'OMN', 'PSE', 'QAT', 'SAU', 'SYR', 'TUR', 'ARE', 'YEM', 'XNC', 'XAK', 'XDH', 'XCB'],
      domain: [24, 11, 64, 43],
    },
    { slug: 'arabian', name: 'Arabian Peninsula', definition: 'Saudi Arabia, Yemen, Oman, the UAE, Qatar, Bahrain, Kuwait', countries: ['SAU', 'YEM', 'OMN', 'ARE', 'QAT', 'BHR', 'KWT'] },
    { slug: 'levant', name: 'Levant', definition: 'Syria, Lebanon, Israel, Palestine, Jordan', countries: ['SYR', 'LBN', 'ISR', 'PSE', 'JOR'] },
    { slug: 'anatolia', name: 'Anatolia', definition: 'Asian Türkiye: every province but the three wholly in Thrace (Edirne, Kırklareli, Tekirdağ)', parts: { TUR: ANATOLIA } },
    { slug: 'caucasus', name: 'Caucasus', definition: 'Georgia, Armenia, Azerbaijan, and Russia’s North Caucasus with Krasnodar, Adygea and Stavropol', countries: TRANSCAUCASIA, parts: { RUS: ['RU-KDA', 'RU-AD', 'RU-KC', 'RU-KB', 'RU-SE', 'RU-IN', 'RU-CE', 'RU-DA', 'RU-STA'] } },
    { slug: 'transcaucasia', name: 'Transcaucasia', definition: 'The South Caucasus: Georgia, Armenia, Azerbaijan', countries: TRANSCAUCASIA },
    { slug: 'persian-gulf', name: 'Persian Gulf', definition: 'The eight states on the Gulf’s shores', countries: ['IRN', 'IRQ', 'KWT', 'SAU', 'BHR', 'QAT', 'ARE', 'OMN'] },
    { slug: 'indian-subcontinent', name: 'Indian Subcontinent', definition: 'India, Pakistan, Bangladesh, Nepal, Bhutan, Sri Lanka, the Maldives', countries: ['IND', 'PAK', 'BGD', 'NPL', 'BTN', 'LKA', 'MDV', 'XSI'] },
    { slug: 'mainland-southeast', name: 'Mainland Southeast Asia', definition: 'Myanmar, Thailand, Laos, Cambodia, Vietnam', countries: ['MMR', 'THA', 'LAO', 'KHM', 'VNM'] },
    { slug: 'maritime-southeast', name: 'Maritime Southeast Asia', definition: 'Brunei, Indonesia, Malaysia, the Philippines, Singapore, Timor-Leste', countries: ['BRN', 'IDN', 'MYS', 'PHL', 'SGP', 'TLS', 'XSP', 'XSR'] },
    { slug: 'indochina', name: 'Indochina', definition: 'The former French Indochina: Vietnam, Laos, Cambodia', countries: ['VNM', 'LAO', 'KHM'] },
    { slug: 'south-china', name: 'South China', definition: 'China’s South Central region south of the Nanling: Guangdong, Guangxi and Hainan, with Hong Kong and Macau', countries: ['HKG', 'MAC'], parts: { CHN: ['CN-GD', 'CN-GX', 'CN-HI'] } },
    { slug: 'korean-peninsula', name: 'Korean Peninsula', definition: 'North Korea and South Korea', countries: ['PRK', 'KOR'] },
    { slug: 'japan', name: 'Japanese Archipelago', definition: 'Japan', countries: ['JPN'] },
    { slug: 'siberia', name: 'Siberia', definition: 'Russia’s West and East Siberian economic regions, from the Urals to Lake Baikal and Transbaikalia', parts: { RUS: [...new Set([...RU_WEST_SIBERIA, ...RU_EAST_SIBERIA])] } },
  ],

  /* ------------------------------------------------------------------ Africa */
  africa: [
    { slug: 'north', name: 'North Africa', definition: 'UN M49 Northern Africa', countries: ['DZA', 'EGY', 'LBY', 'MAR', 'SDN', 'TUN', 'ESH', 'XBT'] },
    {
      slug: 'west',
      name: 'West Africa',
      definition: 'UN M49 Western Africa with Cape Verde; Saint Helena, 1,900 km out in the South Atlantic, is left out',
      countries: ['BEN', 'BFA', 'CPV', 'CIV', 'GMB', 'GHA', 'GIN', 'GNB', 'LBR', 'MLI', 'MRT', 'NER', 'NGA', 'SEN', 'SLE', 'TGO'],
      domain: [-26, 3, 17, 28],
    },
    {
      slug: 'east',
      name: 'East Africa',
      definition: 'UN M49 Eastern Africa, the Indian Ocean islands included; the Chagos Archipelago left out',
      countries: ['BDI', 'COM', 'DJI', 'ERI', 'ETH', 'KEN', 'MDG', 'MWI', 'MUS', 'MYT', 'MOZ', 'REU', 'RWA', 'SYC', 'SOM', 'XSO', 'SSD', 'UGA', 'TZA', 'ZMB', 'ZWE'],
      domain: [21, -27, 64, 19],
    },
    { slug: 'central', name: 'Central Africa', definition: 'UN M49 Middle Africa', countries: ['AGO', 'CMR', 'CAF', 'TCD', 'COG', 'COD', 'GNQ', 'GAB', 'STP'] },
    { slug: 'southern', name: 'Southern Africa', definition: 'UN M49 Southern Africa', countries: ['BWA', 'SWZ', 'LSO', 'NAM', 'ZAF'] },
    { slug: 'southern-region', name: 'Southern African Region', definition: 'The continent south of the Congo basin and the East African plateau: Southern Africa with Angola, Zambia, Malawi, Mozambique, Zimbabwe and Madagascar', countries: ['BWA', 'SWZ', 'LSO', 'NAM', 'ZAF', 'AGO', 'ZMB', 'MWI', 'MOZ', 'ZWE', 'MDG'] },
    { slug: 'maghreb', name: 'Maghreb', definition: 'The Greater Maghreb: Morocco, Western Sahara, Algeria, Tunisia, Libya, Mauritania', countries: ['MAR', 'ESH', 'DZA', 'TUN', 'LBY', 'MRT'] },
    {
      slug: 'sahel',
      name: 'Sahel',
      definition: 'The belt between the Sahara and the savanna, about 11°N to 20°N, across the countries it crosses from Senegal to Eritrea',
      countries: ['SEN', 'GMB', 'MRT', 'MLI', 'BFA', 'NER', 'NGA', 'TCD', 'CMR', 'SDN', 'ERI'],
      domain: [-18, 11, 40, 20],
    },
    { slug: 'horn', name: 'Horn of Africa', definition: 'Ethiopia, Eritrea, Djibouti, Somalia (with Somaliland)', countries: ['ETH', 'ERI', 'DJI', 'SOM', 'XSO'] },
    { slug: 'great-lakes', name: 'Great Lakes Region', definition: 'The states around the African Great Lakes: Burundi, Rwanda, Uganda, Kenya, Tanzania, DR Congo', countries: ['BDI', 'RWA', 'UGA', 'KEN', 'TZA', 'COD'] },
    { slug: 'nile-valley', name: 'Nile Valley', definition: 'Egypt, Sudan, South Sudan', countries: ['EGY', 'SDN', 'SSD'] },
    { slug: 'gulf-of-guinea', name: 'Gulf of Guinea', definition: 'The coast from Liberia to Gabon, and São Tomé and Príncipe', countries: ['LBR', 'CIV', 'GHA', 'TGO', 'BEN', 'NGA', 'CMR', 'GNQ', 'GAB', 'STP'] },
    { slug: 'east-coast', name: 'East African Coast', definition: 'The Swahili coast’s states: Somalia, Kenya, Tanzania, Mozambique, with the Comoros', countries: ['SOM', 'KEN', 'TZA', 'MOZ', 'COM'] },
    { slug: 'rainforest', name: 'Central African Rainforest Region', definition: 'The Congo Basin forest’s six states: Cameroon, the Central African Republic, the Republic of the Congo, DR Congo, Equatorial Guinea, Gabon', countries: ['CMR', 'CAF', 'COG', 'COD', 'GNQ', 'GAB'] },
  ],

  /* ----------------------------------------------------------- North America */
  'north-america': [
    { slug: 'northern', name: 'Northern America', definition: 'UN M49 Northern America', countries: ['BMU', 'CAN', 'GRL', 'SPM', 'USA'] },
    { slug: 'central', name: 'Central America', definition: 'UN M49 Central America without Mexico: the seven isthmus states', countries: ['BLZ', 'CRI', 'SLV', 'GTM', 'HND', 'NIC', 'PAN'] },
    { slug: 'caribbean', name: 'Caribbean', definition: 'UN M49 Caribbean', countries: ['ABW', 'AIA', 'ATG', 'BHS', 'BLM', 'BES', 'BRB', 'CUB', 'CUW', 'CYM', 'DMA', 'DOM', 'GLP', 'GRD', 'HTI', 'JAM', 'KNA', 'LCA', 'MAF', 'MSR', 'MTQ', 'PRI', 'SXM', 'TCA', 'TTO', 'VCT', 'VGB', 'VIR', 'XGB', 'XBN', 'XSN'] },
    { slug: 'greater-antilles', name: 'Greater Antilles', definition: 'Cuba, Hispaniola, Jamaica, Puerto Rico and the Cayman Islands', countries: ['CUB', 'XGB', 'HTI', 'DOM', 'JAM', 'PRI', 'CYM'] },
    { slug: 'lesser-antilles', name: 'Lesser Antilles', definition: 'The Virgin Islands to Trinidad and Tobago, with the Leeward Antilles (Aruba, Curaçao, Bonaire)', countries: ['VIR', 'VGB', 'AIA', 'MAF', 'SXM', 'BLM', 'KNA', 'ATG', 'MSR', 'GLP', 'DMA', 'MTQ', 'LCA', 'VCT', 'BRB', 'GRD', 'TTO', 'ABW', 'CUW', 'BES'] },
    { slug: 'mexico', name: 'Mexico', definition: 'Mexico', countries: ['MEX'] },
    { slug: 'yucatan', name: 'Yucatán Peninsula', definition: 'Yucatán, Campeche and Quintana Roo, Belize, and Guatemala’s Petén', countries: ['BLZ'], parts: { MEX: ['MX-YUC', 'MX-CAM', 'MX-ROO'], GTM: ['GT-PE'] } },
    { slug: 'baja-california', name: 'Baja California', definition: 'The states of Baja California and Baja California Sur', parts: { MEX: ['MX-BCN', 'MX-BCS'] } },
    { slug: 'gulf-coast', name: 'Gulf Coast', definition: 'The five US states on the Gulf of Mexico: Texas, Louisiana, Mississippi, Alabama, Florida', parts: { USA: us('TX', 'LA', 'MS', 'AL', 'FL') } },
    { slug: 'great-lakes', name: 'Great Lakes Region', definition: 'The eight Great Lakes states and Ontario', parts: { USA: us('MN', 'WI', 'IL', 'IN', 'MI', 'OH', 'PA', 'NY'), CAN: ca('ON') } },
    { slug: 'new-england', name: 'New England', definition: 'US Census New England division', parts: { USA: us('ME', 'NH', 'VT', 'MA', 'RI', 'CT') } },
    { slug: 'pacific-northwest', name: 'Pacific Northwest', definition: 'Washington, Oregon, Idaho and British Columbia', parts: { USA: us('WA', 'OR', 'ID'), CAN: ca('BC') } },
    { slug: 'southwest', name: 'American Southwest', definition: 'The Four Corners states and Nevada: Arizona, New Mexico, Utah, Colorado, Nevada', parts: { USA: us('AZ', 'NM', 'UT', 'CO', 'NV') } },
    { slug: 'midwest', name: 'American Midwest', definition: 'US Census Midwest region', parts: { USA: us('IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI') } },
    { slug: 'southeast', name: 'American Southeast', definition: 'US Census South Atlantic and East South Central divisions, without Delaware, Maryland and DC', parts: { USA: us('AL', 'FL', 'GA', 'KY', 'MS', 'NC', 'SC', 'TN', 'VA', 'WV') } },
    { slug: 'northeast', name: 'American Northeast', definition: 'US Census Northeast region', parts: { USA: us('CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA') } },
    { slug: 'canadian-prairies', name: 'Canadian Prairies', definition: 'Alberta, Saskatchewan, Manitoba', parts: { CAN: ca('AB', 'SK', 'MB') } },
    { slug: 'canadian-arctic', name: 'Canadian Arctic', definition: 'Canada’s three territories: Yukon, the Northwest Territories, Nunavut', parts: { CAN: ca('YT', 'NT', 'NU') } },
    { slug: 'western-canada', name: 'Western Canada', definition: 'The four western provinces: British Columbia, Alberta, Saskatchewan, Manitoba', parts: { CAN: ca('BC', 'AB', 'SK', 'MB') } },
    { slug: 'eastern-canada', name: 'Eastern Canada', definition: 'Ontario, Quebec and the Atlantic provinces', parts: { CAN: ca('ON', 'QC', 'NB', 'NS', 'PE', 'NL') } },
  ],

  /* ----------------------------------------------------------- South America */
  'south-america': [
    { slug: 'andes', name: 'Andes', definition: 'The seven Andean states: Venezuela, Colombia, Ecuador, Peru, Bolivia, Chile, Argentina', countries: ['VEN', 'COL', 'ECU', 'PER', 'BOL', 'CHL', 'ARG'] },
    {
      slug: 'amazon',
      name: 'Amazon Basin',
      definition: 'The basin’s seven states, framed on the Amazon drainage basin',
      countries: ['BRA', 'PER', 'BOL', 'COL', 'ECU', 'VEN', 'GUY'],
      domain: [-79.7, -20.5, -48, 5.3],
    },
    {
      slug: 'guiana-shield',
      name: 'Guiana Shield',
      definition: 'The Guianas and their neighbours, framed on the shield between the Orinoco and the Amazon',
      countries: ['GUY', 'SUR', 'GUF', 'VEN', 'COL', 'BRA'],
      domain: [-73, -2, -50, 9],
    },
    { slug: 'southern-cone', name: 'Southern Cone', definition: 'Argentina, Chile, Uruguay, Paraguay', countries: ['ARG', 'CHL', 'URY', 'PRY'] },
    { slug: 'rio-de-la-plata', name: 'Río de la Plata Region', definition: 'The estuary’s shores: Uruguay, and Argentina’s Buenos Aires (city and province) and Entre Ríos', countries: ['URY'], parts: { ARG: ['AR-B', 'AR-C', 'AR-E'] } },
    { slug: 'patagonia', name: 'Patagonia', definition: 'Neuquén, Río Negro, Chubut, Santa Cruz and Tierra del Fuego in Argentina; Aysén and Magallanes in Chile', parts: { ARG: ['AR-Q', 'AR-R', 'AR-U', 'AR-Z', 'AR-V'], CHL: ['CL-AI', 'CL-MA'] } },
    {
      slug: 'gran-chaco',
      name: 'Gran Chaco',
      definition: 'Argentina, Bolivia, Paraguay and Brazil, framed on the Chaco plain',
      countries: ['ARG', 'BOL', 'PRY', 'BRA'],
      domain: [-67, -33.9, -57, -17.5],
    },
    { slug: 'atacama', name: 'Atacama Region', definition: 'The Atacama Desert: Chile’s four northern regions, Arica y Parinacota to Atacama', parts: { CHL: ['CL-AP', 'CL-TA', 'CL-AN', 'CL-AT'] } },
    { slug: 'brazilian-highlands', name: 'Brazilian Highlands', definition: 'The core of the plateau: Minas Gerais, Goiás, the Federal District and Tocantins', parts: { BRA: br('MG', 'GO', 'DF', 'TO') } },
    { slug: 'northeast-brazil', name: 'Northeast Brazil', definition: 'IBGE Northeast region', parts: { BRA: br('MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA') } },
    { slug: 'southeast-brazil', name: 'Southeast Brazil', definition: 'IBGE Southeast region', parts: { BRA: br('MG', 'ES', 'RJ', 'SP') } },
    { slug: 'central-brazil', name: 'Central Brazil', definition: 'IBGE Central-West region', parts: { BRA: br('MT', 'MS', 'GO', 'DF') } },
    { slug: 'southern-brazil', name: 'Southern Brazil', definition: 'IBGE South region', parts: { BRA: br('PR', 'SC', 'RS') } },
  ],

  /* ----------------------------------------------------------------- Oceania */
  oceania: [
    { slug: 'australasia', name: 'Australasia', definition: 'Australia, New Zealand, Papua New Guinea and Norfolk Island', countries: ['AUS', 'NZL', 'PNG', 'NFK', 'XCS'] },
    { slug: 'melanesia', name: 'Melanesia', definition: 'UN M49 Melanesia', countries: MELANESIA },
    {
      slug: 'micronesia',
      name: 'Micronesia',
      definition: 'UN M49 Micronesia, west of the 180th meridian; Kiribati’s Phoenix and Line Islands lie in Polynesian waters',
      countries: ['FSM', 'GUM', 'KIR', 'MHL', 'MNP', 'NRU', 'PLW'],
      domain: [129, -3, 180, 21],
    },
    {
      slug: 'polynesia',
      name: 'Polynesia',
      definition: 'UN M49 Polynesia; Hawaii, New Zealand and Easter Island belong to other countries’ maps',
      countries: POLYNESIA,
      domain: [172, -30, 236, -3],
    },
    { slug: 'new-zealand', name: 'New Zealand', definition: 'New Zealand, the Chatham Islands included; the Kermadecs and subantarctic islands left out', countries: ['NZL'], domain: [165, -48, 184, -34] },
    {
      slug: 'new-guinea',
      name: 'New Guinea',
      definition: 'The island: Papua New Guinea’s mainland provinces and Indonesia’s Papua provinces',
      parts: {
        PNG: ['PG-SAN', 'PG-WPD', 'PG-ESW', 'PG-MPM', 'PG-MPL', 'PG-NPP', 'PG-MBA', 'PG-CPM', 'PG-NCD', 'PG-GPK', 'PG-CPK', 'PG-EPW', 'PG-WHM', 'PG-SHM', 'PG-EHG'],
        IDN: ['ID-PA', 'ID-PB'],
      },
    },
    {
      slug: 'melanesian-islands',
      name: 'Melanesian Islands',
      definition: 'Melanesia apart from New Guinea: Fiji, New Caledonia, the Solomons, Vanuatu, and PNG’s Bismarck Archipelago and Bougainville',
      countries: ['FJI', 'NCL', 'SLB', 'VUT'],
      parts: { PNG: ['PG-NSB', 'PG-WBK', 'PG-EBR', 'PG-NIK', 'PG-MRL'] },
    },
    {
      slug: 'coral-sea',
      name: 'Coral Sea Region',
      definition: 'The Coral Sea and its shores: Queensland’s coast, southern Papua New Guinea, the Solomons, Vanuatu, New Caledonia',
      countries: ['AUS', 'PNG', 'SLB', 'VUT', 'NCL', 'XCS'],
      domain: [142, -30, 170.5, -6],
    },
    {
      slug: 'south-pacific',
      name: 'South Pacific',
      definition: 'The Pacific Island states and territories south of the equator: Melanesia, Polynesia and Nauru',
      countries: [...MELANESIA, ...POLYNESIA, 'NRU'],
      domain: [140, -30, 236, 0],
    },
  ],
}
