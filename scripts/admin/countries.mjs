/**
 * The curated administrative world: which subdivisions each country is drawn with.
 *
 * This file is the whole of the editorial decision, and the only place it is made. The
 * engine (`build-admin.mjs`) reads it and knows nothing about any country.
 *
 * Every country starts from Natural Earth's admin-1 layer — the level called `ne` below —
 * because that layer shares its coastline, its islands and its international borders with
 * the World map, vertex for vertex. A country whose admin-1 units are the right size needs
 * no entry here at all. An entry exists where they are not:
 *
 *   - too fine for a map of the world (Slovenia's 193 municipalities): the units are
 *     dissolved into an official coarser division, and each result remembers what it was
 *     made of;
 *   - too coarse (Germany's 16 Länder): the units are cut into a finer official division
 *     from another source, keeping Natural Earth's outline and taking only the new internal
 *     lines from that source;
 *   - out of date (Kenya's 8 provinces, abolished in 2013): the current division is used.
 *
 * ## Shape of an entry
 *
 *   ISO3: {
 *     note: 'why this country is drawn this way',
 *     levels: { levelId: LEVEL, ... },   // besides the built-in `ne` and `country`
 *     curated: levelId,                   // the default map ("Curated Default")
 *     detailed: levelId,                  // "More Detailed"; defaults to `curated`
 *     maximum: levelId,                   // "Maximum Available Detail"; defaults to the
 *                                         // finer of `detailed` and `ne`
 *     ne: { name, kind },                 // how to describe Natural Earth's own level
 *     kinds: { unit: 'State', '*': … },   // corrections to Natural Earth's unit types;
 *                                         // '*' for every unit not named
 *     groups: [GROUPS, ...],              // regions a user can select as one (Catalonia)
 *   }
 *
 * A LEVEL describes itself — `name` (plural, for the level), `kind` (singular, for a
 * unit), `code` (a short tag used in the ids of the units it creates), `adminLevel` and
 * `vintage` — and has one recipe:
 *
 *   group: how Natural Earth units join. One of
 *     { key: 'region' }              the value of a Natural Earth attribute
 *     { key: (props) => string }     a function of the attributes
 *     { table: { code: { name, members: [...] } }, rest: 'self' | code }
 *     { absorb: { target: [members] } }   a unit takes others in; the rest stay as they are
 *     { within: gb('MKD', 'ADM1') }  the unit of another source it lies in
 *   with `names: { key: 'Name' | { name, local, code, kind } }`.
 *   Members are named by Natural Earth `adm1_code`, ISO 3166-2 code or name, tried in that
 *   order, so a table survives a unit being renamed.
 *
 *   split: { base: levelId | 'ne' | 'country', source: gb(ISO, LEVEL), merge?: true,
 *            name?: (name) => string, kindOf?: (name) => string,
 *            only?: [Natural Earth units], join?: { Name: [source unit names] } }
 *     cuts the base level's units into the source's finer units. With `only`, just those
 *     units are cut and every other passes through untouched. With `join`, the named source
 *     units become one piece each, and the rest of the unit — its own id, name and
 *     description kept — is what remains.
 *
 * A unit keeps Natural Earth's id wherever its geometry is Natural Earth's unit unchanged
 * — a group of one, a split into one piece — so it is the same entity at every level and in
 * every older map. A unit made of several gets `ISO3-CODE-unit`.
 *
 * GROUPS are regions a user can select in one go. Each unit of every level is placed in
 * them through the Natural Earth units it was made from:
 *   { scheme: 'Autonomous community', key: 'region', names: {...} }
 *   { scheme: 'Historical region', table: { name: [members] }, approximate: true, note }
 * The levels themselves are groups too: a Kreis is in its Regierungsbezirk and its Land.
 */

/** A geoBoundaries layer, by country and level. See `sources.mjs`. */
const gb = (iso, level) => ({ geoBoundaries: [iso, level] })

export const POLICY = {
  /**
   * A country smaller than this is one unit on the curated map. Its subdivisions are the
   * size of a single French department's commune, and at world scale they are specks —
   * Andorra's seven parishes, Liechtenstein's eleven municipalities. `maximum` still has
   * them. An island state whose parts are far apart and distinct is listed below instead.
   */
  wholeCountryBelowKm2: 3000,
}

/** Small territories whose parts are separate islands or island groups, kept apart. */
const ISLAND_GROUPS = [
  'SHN', // Saint Helena, Ascension and Tristan da Cunha: three islands 1,300-2,400 km apart
  'XIO', // Christmas Island and the Cocos (Keeling) Islands (Natural Earth's Indian Ocean Ter.)
  'UMI', // the US minor outlying islands, scattered across the Pacific and the Caribbean
  'STP', // São Tomé and Príncipe
  'COM', // Grande Comore, Mohéli and Anjouan
  'FSM', // the four states of Micronesia, 2,700 km end to end
  'KIR', // Kiribati's island groups
  'MHL', // the Ratak and Ralik chains
  'TON', // Tonga's island groups
  'SPM', // Saint-Pierre and Miquelon
  'ATF', // Kerguelen, Crozet, Amsterdam and Saint-Paul, the Scattered Islands
  'WLF', // Wallis, and Futuna's two kingdoms
  'VIR', // Saint Croix, Saint Thomas and Saint John
  'MNP', // Saipan, Tinian, Rota and the Northern Islands
  'ASM', // Tutuila, Manuʻa, Swains and Rose
]

/**
 * What Natural Earth's own level is called in each country, where the country keeps it.
 * Only a name — the geometry is Natural Earth's — so the inspector says "Voivodeship of
 * Poland" rather than "First-level subdivision". An entry's own `ne` wins over this.
 */
export const NE_LEVEL_NAMES = {
  AFG: ['Provinces', 'Province'], AGO: ['Provinces', 'Province'], ALB: ['Counties', 'County'],
  ARG: ['Provinces', 'Province'], ARM: ['Provinces', 'Province'], AUT: ['States', 'State'],
  BEL: ['Provinces', 'Province'], BGD: ['Divisions', 'Division'], BGR: ['Provinces', 'Province'],
  BIH: ['Entities and cantons', 'Canton'], BLR: ['Regions', 'Region'], BOL: ['Departments', 'Department'],
  BRA: ['States', 'State'], CAN: ['Provinces and territories', 'Province'], CHE: ['Cantons', 'Canton'],
  CHL: ['Regions', 'Region'], CHN: ['Provinces', 'Province'], CIV: ['Regions', 'Region'],
  CMR: ['Regions', 'Region'], COD: ['Provinces', 'Province'], COL: ['Departments', 'Department'],
  CUB: ['Provinces', 'Province'], CZE: ['Regions', 'Region'], DNK: ['Regions', 'Region'],
  DZA: ['Provinces', 'Province'], ECU: ['Provinces', 'Province'], EGY: ['Governorates', 'Governorate'],
  EST: ['Counties', 'County'], ETH: ['Regions', 'Region'], FIN: ['Regions', 'Region'],
  GEO: ['Regions', 'Region'], GHA: ['Regions', 'Region'], GRC: ['Regions', 'Region'],
  HRV: ['Counties', 'County'], IDN: ['Provinces', 'Province'], IND: ['States and union territories', 'State'],
  IRN: ['Provinces', 'Province'], IRQ: ['Governorates', 'Governorate'], ISL: ['Regions', 'Region'],
  JPN: ['Prefectures', 'Prefecture'], KAZ: ['Regions', 'Region'], KOR: ['Provinces', 'Province'],
  LTU: ['Counties', 'County'], MAR: ['Regions', 'Region'], MDG: ['Regions', 'Region'],
  MEX: ['States', 'State'], MMR: ['Regions and states', 'Region'], MNG: ['Provinces', 'Province'],
  MOZ: ['Provinces', 'Province'], MYS: ['States', 'State'], NGA: ['States', 'State'],
  NLD: ['Provinces', 'Province'], NOR: ['Counties', 'County'], NZL: ['Regions', 'Region'],
  PER: ['Regions', 'Region'], POL: ['Voivodeships', 'Voivodeship'], PRT: ['Districts and autonomous regions', 'District'],
  RUS: ['Federal subjects', 'Federal subject'], RWA: ['Provinces', 'Province'], SAU: ['Regions', 'Region'],
  SDN: ['States', 'State'], SRB: ['Districts', 'District'], SVK: ['Regions', 'Region'],
  SWE: ['Counties', 'County'], SYR: ['Governorates', 'Governorate'], THA: ['Provinces', 'Province'],
  TUR: ['Provinces', 'Province'], TZA: ['Regions', 'Region'], UKR: ['Oblasts', 'Oblast'],
  USA: ['States', 'State'], UZB: ['Regions', 'Region'], VEN: ['States', 'State'],
  ZAF: ['Provinces', 'Province'],
}

export const COUNTRIES = {
  ...Object.fromEntries(ISLAND_GROUPS.map((id) => [id, { curated: 'ne', note: 'Separate island groups, kept apart.' }])),

  /* ------------------------------------------------------------------ Europe */

  DEU: {
    note:
      'The 16 Länder are too coarse beside their neighbours: Bavaria alone is the size of ' +
      'Ireland. The Regierungsbezirke (NUTS 2) are the next level down — Upper Bavaria, the ' +
      'three Franconias, Swabia, Weser-Ems — and are real historical regions. Länder without ' +
      'districts are one region. More Detailed uses the 400 Kreise.',
    levels: {
      rb: {
        name: 'Government districts',
        kind: 'Government district',
        code: 'RB',
        adminLevel: 'NUTS 2',
        vintage: 2021,
        split: { base: 'ne', source: gb('DEU', 'ADM2') },
      },
      kreise: {
        name: 'Districts and independent cities',
        kind: 'District',
        code: 'KR',
        adminLevel: 'NUTS 3',
        vintage: 2021,
        split: {
          base: 'rb',
          source: gb('DEU', 'ADM3'),
          // BKG files a district's coastal water and its share of Lake Constance separately.
          merge: true,
          name: (name) => name.replace(/ \(DE\)$/, ''),
          kindOf: (name) => (/Stadtkreis|Kreisfreie Stadt/.test(name) ? 'Independent city' : 'District'),
        },
      },
    },
    ne: { name: 'States', kind: 'State' },
    curated: 'rb',
    detailed: 'kreise',
    maximum: 'kreise',
  },

  UKR: {
    note:
      'Oblasts, as they are, except Odesa Oblast, divided along the Dniester and its estuary, ' +
      'which all but reaches Moldova. South of that water is the Budjak, the southern end of ' +
      'historical Bessarabia (part of Moldavia until 1812): a region of its own here, made of ' +
      "the nine raions that lie there in geoBoundaries' raion layer (2006 boundaries). The rest " +
      'of the oblast keeps its Natural Earth id.',
    levels: {
      oblasts: {
        name: 'Oblasts',
        kind: 'Oblast',
        code: 'OB',
        adminLevel: 'ADM1',
        split: {
          base: 'ne',
          source: gb('UKR', 'ADM2'),
          only: ['UKR-322'],
          // West and south of the Dniester and its estuary, spelled as geoBoundaries spells them.
          join: {
            Budjak: [
              'Artsyi',
              'Bilhorod Dnistrovskyi',
              'Bolhrad',
              'Izmali',
              'Kiliia',
              'Reni',
              'Sarata',
              'Tarutyne',
              'Tatarbunary',
            ],
          },
          kindOf: () => 'Historical region',
        },
      },
    },
    curated: 'oblasts',
    detailed: 'oblasts',
    maximum: 'oblasts',
  },

  FRA: {
    note: 'Departments, as they are. More Detailed divides them into arrondissements.',
    levels: {
      arrondissements: {
        name: 'Arrondissements',
        kind: 'Arrondissement',
        code: 'AR',
        adminLevel: 'ADM3',
        vintage: 2022,
        split: { base: 'ne', source: gb('FRA', 'ADM3') },
      },
    },
    ne: { name: 'Departments', kind: 'Department' },
    detailed: 'arrondissements',
    groups: [{ scheme: 'Region', key: 'region' }],
  },

  BEL: {
    note: 'Provinces and Brussels. More Detailed: the 43 arrondissements.',
    levels: {
      arrondissements: {
        name: 'Arrondissements',
        kind: 'Arrondissement',
        code: 'AR',
        adminLevel: 'ADM3',
        vintage: 2014,
        split: { base: 'ne', source: gb('BEL', 'ADM3') },
      },
    },
    detailed: 'arrondissements',
    groups: [
      {
        scheme: 'Region',
        table: {
          Flanders: ['BE-VAN', 'BE-VBR', 'BE-VLI', 'BE-VOV', 'BE-VWV'],
          Wallonia: ['BE-WBR', 'BE-WHT', 'BE-WLG', 'BE-WLX', 'BE-WNA'],
          'Brussels-Capital Region': ['BE-BRU'],
        },
      },
    ],
  },

  CZE: {
    note: 'The 14 regions (kraje). More Detailed: the 77 districts (okresy).',
    levels: {
      okresy: {
        name: 'Districts',
        kind: 'District',
        code: 'OK',
        adminLevel: 'ADM2',
        vintage: 2010,
        split: { base: 'ne', source: gb('CZE', 'ADM2') },
      },
    },
    detailed: 'okresy',
  },

  GBR: {
    note:
      'Natural Earth draws 232 local authorities, down to London boroughs. The curated map ' +
      'uses the constituent countries and England’s nine regions (ITL 1). More Detailed uses ' +
      'counties and unitary authorities, with Greater London and the six metropolitan ' +
      'counties whole; Maximum is every local authority.',
    levels: {
      itl1: {
        name: 'Countries and regions',
        kind: 'Region',
        code: 'ITL',
        adminLevel: 'ITL 1',
        vintage: 2021,
        group: {
          key: (p) => (p.geonunit === 'England' ? p.region : p.geonunit),
          names: {
            'North East': { name: 'North East', code: 'TLC', kind: 'Region of England' },
            'North West': { name: 'North West', code: 'TLD', kind: 'Region of England' },
            'Yorkshire and the Humber': { name: 'Yorkshire and the Humber', code: 'TLE', kind: 'Region of England' },
            'East Midlands': { name: 'East Midlands', code: 'TLF', kind: 'Region of England' },
            'West Midlands': { name: 'West Midlands', code: 'TLG', kind: 'Region of England' },
            East: { name: 'East of England', code: 'TLH', kind: 'Region of England' },
            'Greater London': { name: 'London', code: 'TLI', kind: 'Region of England' },
            'South East': { name: 'South East', code: 'TLJ', kind: 'Region of England' },
            'South West': { name: 'South West', code: 'TLK', kind: 'Region of England' },
            Wales: { name: 'Wales', local: 'Cymru', code: 'TLL', kind: 'Country' },
            Scotland: { name: 'Scotland', local: 'Alba', code: 'TLM', kind: 'Country' },
            'Northern Ireland': { name: 'Northern Ireland', code: 'TLN', kind: 'Country' },
          },
        },
      },
      counties: {
        name: 'Counties and unitary authorities',
        kind: 'County or unitary authority',
        code: 'CTY',
        adminLevel: 'ADM2',
        group: {
          rest: 'self',
          table: {
            LND: { name: 'Greater London', kind: 'Region (Greater London)', members: (p) => p.region === 'Greater London' },
            GTM: { name: 'Greater Manchester', kind: 'Metropolitan county', members: ['GB-BOL', 'GB-BUR', 'GB-MAN', 'GB-OLD', 'GB-RCH', 'GB-SLF', 'GB-SKP', 'GB-TAM', 'GB-TRF', 'GB-WGN'] },
            MSY: { name: 'Merseyside', kind: 'Metropolitan county', members: ['GB-KWL', 'GB-LIV', 'GB-SFT', 'GB-SHN', 'GB-WRL'] },
            SYK: { name: 'South Yorkshire', kind: 'Metropolitan county', members: ['GB-BNS', 'GB-DNC', 'GB-ROT', 'GB-SHF'] },
            TWR: { name: 'Tyne and Wear', kind: 'Metropolitan county', members: ['GB-GAT', 'GB-NET', 'GB-NTY', 'GB-STY', 'GB-SND'] },
            WMD: { name: 'West Midlands', kind: 'Metropolitan county', members: ['GB-BIR', 'GB-COV', 'GB-DUD', 'GB-SAW', 'GB-SOL', 'GB-WLL', 'GB-WLV'] },
            WYK: { name: 'West Yorkshire', kind: 'Metropolitan county', members: ['GB-BRD', 'GB-CLD', 'GB-KIR', 'GB-LDS', 'GB-WKF'] },
          },
        },
      },
    },
    ne: { name: 'Local authorities', kind: 'Local authority' },
    curated: 'itl1',
    detailed: 'counties',
    maximum: 'ne',
  },

  IRL: {
    note:
      'The 26 traditional counties. Natural Earth splits Dublin into four councils and Cork, ' +
      'Galway, Limerick, Waterford and Tipperary into city and county; they are joined again.',
    levels: {
      counties: {
        name: 'Counties',
        kind: 'County',
        code: 'CO',
        adminLevel: 'ADM2',
        group: {
          key: 'iso_3166_2',
          names: {
            'IE-D': { name: 'Dublin', local: 'Baile Átha Cliath' },
            'IE-CO': { name: 'Cork', local: 'Corcaigh' },
            'IE-G': { name: 'Galway', local: 'Gaillimh' },
            'IE-LK': { name: 'Limerick', local: 'Luimneach' },
            'IE-WD': { name: 'Waterford', local: 'Port Láirge' },
            'IE-TA': { name: 'Tipperary', local: 'Tiobraid Árann' },
          },
        },
      },
    },
    curated: 'counties',
    groups: [
      {
        scheme: 'Province',
        table: {
          Connacht: ['IE-G', 'IE-LM', 'IE-MO', 'IE-RN', 'IE-SO'],
          Leinster: ['IE-CW', 'IE-D', 'IE-KE', 'IE-KK', 'IE-LS', 'IE-LD', 'IE-LH', 'IE-MH', 'IE-OY', 'IE-WH', 'IE-WX', 'IE-WW'],
          Munster: ['IE-CE', 'IE-CO', 'IE-KY', 'IE-LK', 'IE-TA', 'IE-WD'],
          'Ulster (Ireland)': ['IE-CN', 'IE-DL', 'IE-MN'],
        },
      },
    ],
  },

  SVN: {
    note:
      'Natural Earth draws Slovenia’s 193 municipalities, which average 100 km². The 12 ' +
      'statistical regions (NUTS 3) are the division Slovenia itself reports by.',
    levels: {
      regions: {
        name: 'Statistical regions',
        kind: 'Statistical region',
        code: 'SR',
        adminLevel: 'NUTS 3',
        group: {
          key: 'region',
          names: {
            Pomurska: { name: 'Mura', local: 'Pomurska', code: 'SI031' },
            Podravska: { name: 'Drava', local: 'Podravska', code: 'SI032' },
            Koroška: { name: 'Carinthia', local: 'Koroška', code: 'SI033' },
            Savinjska: { name: 'Savinja', local: 'Savinjska', code: 'SI034' },
            Zasavska: { name: 'Central Sava', local: 'Zasavska', code: 'SI035' },
            Spodnjeposavska: { name: 'Lower Sava', local: 'Posavska', code: 'SI036' },
            'Jugovzhodna Slovenija': { name: 'Southeast Slovenia', local: 'Jugovzhodna Slovenija', code: 'SI037' },
            'Notranjsko-kraška': { name: 'Littoral–Inner Carniola', local: 'Primorsko-notranjska', code: 'SI038' },
            Osrednjeslovenska: { name: 'Central Slovenia', local: 'Osrednjeslovenska', code: 'SI041' },
            Gorenjska: { name: 'Upper Carniola', local: 'Gorenjska', code: 'SI042' },
            Goriška: { name: 'Gorizia', local: 'Goriška', code: 'SI043' },
            'Obalno-kraška': { name: 'Coastal–Karst', local: 'Obalno-kraška', code: 'SI044' },
          },
        },
      },
    },
    ne: { name: 'Municipalities', kind: 'Municipality' },
    curated: 'regions',
  },

  LVA: {
    note:
      'Natural Earth draws the 119 municipalities of 2009-2021. The curated map uses the six ' +
      'statistical regions — Riga, Pierīga, Vidzeme, Kurzeme, Zemgale, Latgale — which carry ' +
      'the historical lands. More Detailed uses the 43 municipalities of the 2021 reform.',
    levels: {
      regions: {
        name: 'Statistical regions',
        kind: 'Statistical region',
        code: 'SR',
        adminLevel: 'NUTS 3',
        group: {
          key: 'region_sub',
          names: {
            Riga: { name: 'Riga', local: 'Rīga', code: 'LV006' },
            Pierīga: { name: 'Pierīga', code: 'LV007' },
            Vidzeme: { name: 'Vidzeme', code: 'LV008' },
            Kurzeme: { name: 'Kurzeme', code: 'LV003' },
            Zemgale: { name: 'Zemgale', code: 'LV009' },
            Latgale: { name: 'Latgale', code: 'LV005' },
          },
        },
      },
      municipalities: {
        name: 'Municipalities (2021)',
        kind: 'Municipality',
        code: 'NOV',
        adminLevel: 'ADM1',
        vintage: 2021,
        split: { base: 'country', source: gb('LVA', 'ADM1') },
      },
    },
    ne: { name: 'Municipalities (2009-2021)', kind: 'Municipality' },
    curated: 'regions',
    detailed: 'municipalities',
    maximum: 'municipalities',
  },

  MKD: {
    note: 'The eight statistical regions instead of 84 municipalities.',
    levels: {
      regions: {
        name: 'Statistical regions',
        kind: 'Statistical region',
        code: 'SR',
        adminLevel: 'NUTS 3',
        group: { within: gb('MKD', 'ADM1') },
      },
    },
    ne: { name: 'Municipalities', kind: 'Municipality' },
    curated: 'regions',
  },

  XKX: {
    note: 'The seven districts instead of 30 municipalities.',
    levels: {
      districts: {
        name: 'Districts',
        kind: 'District',
        code: 'D',
        group: {
          key: 'region',
          names: {
            Pristina: { name: 'Pristina', local: 'Prishtinë / Priština' },
            'Kosovska Mitrovica': { name: 'Mitrovica', local: 'Mitrovicë / Mitrovica' },
            Peć: { name: 'Peja', local: 'Pejë / Peć' },
            Prizren: { name: 'Prizren' },
            Uroševac: { name: 'Ferizaj', local: 'Ferizaj / Uroševac' },
            Gnjilane: { name: 'Gjilan', local: 'Gjilan / Gnjilane' },
            Đakovica: { name: 'Gjakova', local: 'Gjakovë / Đakovica' },
          },
        },
      },
    },
    ne: { name: 'Municipalities', kind: 'Municipality' },
    curated: 'districts',
  },

  MNE: {
    note: 'Montenegro’s three statistical regions instead of 21 municipalities.',
    levels: {
      regions: {
        name: 'Statistical regions',
        kind: 'Statistical region',
        code: 'SR',
        adminLevel: 'NUTS 3',
        group: {
          table: {
            COAST: { name: 'Coastal region', local: 'Primorski region', members: ['ME-02', 'ME-05', 'ME-08', 'ME-10', 'ME-19', 'ME-20'] },
            CENTRE: { name: 'Central region', local: 'Središnji region', members: ['ME-06', 'ME-07', 'ME-12', 'ME-16'] },
            NORTH: {
              name: 'Northern region',
              local: 'Sjeverni region',
              members: ['ME-01', 'ME-03', 'ME-04', 'ME-09', 'ME-11', 'ME-13', 'ME-14', 'ME-15', 'ME-17', 'ME-18', 'ME-21'],
            },
          },
        },
      },
    },
    ne: { name: 'Municipalities', kind: 'Municipality' },
    curated: 'regions',
  },

  MDA: {
    note:
      'The development regions — North, Centre, South — with Chișinău, Gagauzia and the ' +
      'left bank of the Dniester, instead of 40 districts. Natural Earth files Bender with ' +
      'the left-bank units and does not separate the government-controlled part of Dubăsari.',
    levels: {
      regions: {
        name: 'Development regions',
        kind: 'Development region',
        code: 'DR',
        adminLevel: 'NUTS 2',
        group: {
          table: {
            NORD: { name: 'North', local: 'Nord', members: ['MD-BR', 'MD-ED', 'MD-RI', 'MD-GL', 'MD-FA', 'MD-OC', 'MD-DO', 'MD-SO', 'MD-DR', 'MD-SI', 'MD-FL', 'MD-BA'] },
            CENTRU: { name: 'Centre', local: 'Centru', members: ['MD-UN', 'MD-NI', 'MD-HI', 'MD-CR', 'MD-ST', 'MD-AN', 'MD-OR', 'MD-TE', 'MD-SD', 'MD-IA', 'MD-CL', 'MDA-1644'] },
            SUD: { name: 'South', local: 'Sud', members: ['MD-LE', 'MD-CT', 'MD-CA', 'MD-SV', 'MD-CS', 'MD-CM', 'MD-BS', 'MD-TA'] },
            CU: { name: 'Chișinău', kind: 'Municipality', members: ['MD-CU'] },
            GA: { name: 'Gagauzia', local: 'Găgăuzia', kind: 'Autonomous territorial unit', members: ['MD-GA'] },
            SN: {
              name: 'Transnistria',
              local: 'Stînga Nistrului',
              kind: 'Administrative-territorial units of the Left Bank',
              members: ['MDA-1628', 'MDA-1638', 'MD-CAM', 'MD-GRI', 'MDA-1645', 'MD-BD'],
            },
          },
        },
      },
    },
    ne: { name: 'Districts', kind: 'District' },
    curated: 'regions',
  },

  HUN: {
    note:
      'The 19 counties and Budapest. Natural Earth draws the 23 cities with county rights as ' +
      'holes in their counties; each is joined to the county around it.',
    levels: {
      counties: {
        name: 'Counties',
        kind: 'County',
        code: 'CO',
        adminLevel: 'NUTS 3',
        group: {
          absorb: {
            'HU-GS': ['HU-SN', 'HU-GY'],
            'HU-CS': ['HU-SD', 'HU-HV'],
            'HU-NO': ['HU-ST'],
            'HU-JN': ['HU-SK'],
            'HU-PE': ['HU-ED'],
            'HU-HE': ['HU-EG'],
            'HU-BZ': ['HU-MI'],
            'HU-FE': ['HU-DU', 'HU-SF'],
            'HU-BK': ['HU-KM'],
            'HU-KE': ['HU-TB'],
            'HU-VA': ['HU-SH'],
            'HU-ZA': ['HU-ZE', 'HU-NK'],
            'HU-VE': ['HU-VM'],
            'HU-SO': ['HU-KV'],
            'HU-BA': ['HU-PS'],
            'HU-TO': ['HU-SS'],
            'HU-BE': ['HU-BC'],
            'HU-HB': ['HU-DE'],
            'HU-SZ': ['HU-NY'],
          },
        },
      },
    },
    curated: 'counties',
    groups: [{ scheme: 'Statistical region', key: 'region' }],
  },

  MLT: {
    note: 'Malta and Gozo (NUTS 3) instead of 68 local councils.',
    levels: {
      regions: {
        name: 'Regions',
        kind: 'Region',
        code: 'R',
        adminLevel: 'NUTS 3',
        group: {
          key: (p) => (p.region === 'Gozo' ? 'MT002' : 'MT001'),
          names: { MT001: { name: 'Malta' }, MT002: { name: 'Gozo and Comino', local: 'Għawdex u Kemmuna' } },
        },
      },
    },
    ne: { name: 'Local councils', kind: 'Local council' },
    curated: 'regions',
  },

  AZE: {
    note:
      'The 14 economic regions of the 2021 reform instead of 78 districts; Nakhchivan is one ' +
      'of them. Composition from the presidential decree of 7 July 2021.',
    levels: {
      regions: {
        name: 'Economic regions',
        kind: 'Economic region',
        code: 'ER',
        adminLevel: 'ADM1',
        vintage: 2021,
        group: {
          table: {
            BAKU: { name: 'Baku', local: 'Bakı', members: ['AZ-BA'] },
            ABS: { name: 'Absheron-Khizi', local: 'Abşeron-Xızı', members: ['AZ-ABS', 'AZ-XIZ', 'AZ-SM'] },
            DSH: { name: 'Mountainous Shirvan', local: 'Dağlıq Şirvan', members: ['AZ-AGU', 'AZ-SMI', 'AZ-QOB', 'AZ-ISM'] },
            GDA: { name: 'Ganja-Dashkasan', local: 'Gəncə-Daşkəsən', members: ['AZ-GA', 'AZ-DAS', 'AZ-GYG', 'AZ-SMX', 'AZ-NA', 'AZ-GOR'] },
            GTO: { name: 'Gazakh-Tovuz', local: 'Qazax-Tovuz', members: ['AZ-QAZ', 'AZ-AGA', 'AZ-TOV', 'AZ-GAD', 'AZ-SKR'] },
            GKH: { name: 'Guba-Khachmaz', local: 'Quba-Xaçmaz', members: ['AZ-XAC', 'AZ-QUS', 'AZ-SBN', 'AZ-SIY', 'AZ-QBA'] },
            KAR: { name: 'Karabakh', local: 'Qarabağ', members: ['AZ-XA', 'AZ-AGC', 'AZ-AGM', 'AZ-BAR', 'AZ-FUZ', 'AZ-XCI', 'AZ-XVD', 'AZ-SUS', 'AZ-X01~', 'AZ-TAR'] },
            EZA: { name: 'East Zangezur', local: 'Şərqi Zəngəzur', members: ['AZ-CAB', 'AZ-KAL', 'AZ-QBI', 'AZ-LAN', 'AZ-ZAN'] },
            LAS: { name: 'Lankaran-Astara', local: 'Lənkəran-Astara', members: ['AZ-LA', 'AZ-AST', 'AZ-LER', 'AZ-YAR', 'AZ-MAS', 'AZ-CAL'] },
            CAR: { name: 'Central Aran', local: 'Mərkəzi Aran', members: ['AZ-MI', 'AZ-YEV', 'AZ-AGS', 'AZ-GOY', 'AZ-UCA', 'AZ-ZAR', 'AZ-KUR'] },
            MIM: { name: 'Mil-Mughan', local: 'Mil-Muğan', members: ['AZ-IMI', 'AZ-BEY', 'AZ-SAT', 'AZ-SAB'] },
            SZA: { name: 'Shaki-Zagatala', local: 'Şəki-Zaqatala', members: ['AZ-SA', 'AZ-ZAQ', 'AZ-BAL', 'AZ-QAX', 'AZ-OGU', 'AZ-QAB'] },
            SSA: { name: 'Shirvan-Salyan', local: 'Şirvan-Salyan', members: ['AZ-SR', 'AZ-SAL', 'AZ-NEF', 'AZ-HAC', 'AZ-BIL'] },
            NAX: {
              name: 'Nakhchivan',
              local: 'Naxçıvan',
              kind: 'Autonomous republic',
              members: ['AZ-NX', 'AZ-SAR', 'AZ-SAD', 'AZ-KAN', 'AZ-BAB', 'AZ-SAH', 'AZ-CUL', 'AZ-ORD'],
            },
          },
        },
      },
    },
    ne: { name: 'Districts', kind: 'District' },
    curated: 'regions',
  },

  ESP: {
    note: 'The 50 provinces and the two autonomous cities; each can be selected by autonomous community.',
    ne: { name: 'Provinces', kind: 'Province' },
    // Natural Earth types every province "Autonomous Community".
    kinds: { '*': 'Province', 'ES-CE': 'Autonomous city', 'ES-ML': 'Autonomous city' },
    groups: [
      {
        scheme: 'Autonomous community',
        key: 'region',
        names: {
          Andalucía: 'Andalusia',
          Aragón: 'Aragon',
          Asturias: 'Asturias',
          'Islas Baleares': 'Balearic Islands',
          'País Vasco': 'Basque Country',
          'Canary Is.': 'Canary Islands',
          Cantabria: 'Cantabria',
          'Castilla y León': 'Castile and León',
          'Castilla-La Mancha': 'Castilla–La Mancha',
          Cataluña: 'Catalonia',
          Extremadura: 'Extremadura',
          Galicia: 'Galicia',
          'La Rioja': 'La Rioja',
          Madrid: 'Community of Madrid',
          Murcia: 'Region of Murcia',
          'Foral de Navarra': 'Navarre',
          Valenciana: 'Valencian Community',
          Ceuta: 'Ceuta',
          Melilla: 'Melilla',
        },
      },
    ],
  },

  ITA: {
    note: 'Provinces; each can be selected by region.',
    ne: { name: 'Provinces', kind: 'Province' },
    groups: [
      {
        scheme: 'Region',
        key: 'region',
        names: {
          Piemonte: 'Piedmont',
          "Valle d'Aosta": 'Aosta Valley',
          Lombardia: 'Lombardy',
          'Trentino-Alto Adige': 'Trentino-South Tyrol',
          Veneto: 'Veneto',
          'Friuli-Venezia Giulia': 'Friuli-Venezia Giulia',
          Liguria: 'Liguria',
          'Emilia-Romagna': 'Emilia-Romagna',
          Toscana: 'Tuscany',
          Umbria: 'Umbria',
          Marche: 'Marche',
          Lazio: 'Lazio',
          Abruzzo: 'Abruzzo',
          Molise: 'Molise',
          Campania: 'Campania',
          Apulia: 'Apulia',
          Basilicata: 'Basilicata',
          Calabria: 'Calabria',
          Sicily: 'Sicily',
          Sardegna: 'Sardinia',
        },
      },
    ],
  },

  ROU: {
    note:
      'The 41 counties and Bucharest. Each can be selected by development region, and by ' +
      'historical region as the counties approximate them.',
    ne: { name: 'Counties', kind: 'County' },
    kinds: { 'RO-B': 'Municipality' },
    groups: [
      {
        scheme: 'Development region',
        table: {
          'Nord-Vest': ['RO-BH', 'RO-BN', 'RO-CJ', 'RO-MM', 'RO-SM', 'RO-SJ'],
          Centru: ['RO-AB', 'RO-BV', 'RO-CV', 'RO-HR', 'RO-MS', 'RO-SB'],
          'Nord-Est': ['RO-BC', 'RO-BT', 'RO-IS', 'RO-NT', 'RO-SV', 'RO-VS'],
          'Sud-Est': ['RO-BR', 'RO-BZ', 'RO-CT', 'RO-GL', 'RO-TL', 'RO-VN'],
          'Sud-Muntenia': ['RO-AG', 'RO-CL', 'RO-DB', 'RO-GR', 'RO-IL', 'RO-PH', 'RO-TR'],
          'București-Ilfov': ['RO-B', 'RO-IF'],
          'Sud-Vest Oltenia': ['RO-DJ', 'RO-GJ', 'RO-MH', 'RO-OT', 'RO-VL'],
          Vest: ['RO-AR', 'RO-CS', 'RO-HD', 'RO-TM'],
        },
      },
      {
        scheme: 'Historical region',
        approximate: true,
        note: 'County-based: county borders follow the historical ones only approximately.',
        table: {
          Transylvania: ['RO-AB', 'RO-BN', 'RO-BV', 'RO-CJ', 'RO-CV', 'RO-HR', 'RO-HD', 'RO-MS', 'RO-SB', 'RO-SJ'],
          Banat: ['RO-TM', 'RO-CS'],
          Crișana: ['RO-AR', 'RO-BH', 'RO-SM'],
          Maramureș: ['RO-MM'],
          Muntenia: ['RO-AG', 'RO-B', 'RO-BR', 'RO-BZ', 'RO-CL', 'RO-DB', 'RO-GR', 'RO-IF', 'RO-IL', 'RO-PH', 'RO-TR'],
          Oltenia: ['RO-DJ', 'RO-GJ', 'RO-MH', 'RO-OT', 'RO-VL'],
          Moldavia: ['RO-BC', 'RO-BT', 'RO-GL', 'RO-IS', 'RO-NT', 'RO-SV', 'RO-VS', 'RO-VN'],
          Dobruja: ['RO-CT', 'RO-TL'],
        },
      },
      {
        scheme: 'Greater historical region',
        approximate: true,
        note: 'County-based. Transylvania in the wider sense of 1918 includes Banat, Crișana and Maramureș.',
        table: {
          'Transylvania (wider sense)': [
            'RO-AB', 'RO-BN', 'RO-BV', 'RO-CJ', 'RO-CV', 'RO-HR', 'RO-HD', 'RO-MS', 'RO-SB', 'RO-SJ',
            'RO-TM', 'RO-CS', 'RO-AR', 'RO-BH', 'RO-SM', 'RO-MM',
          ],
          Wallachia: ['RO-AG', 'RO-B', 'RO-BR', 'RO-BZ', 'RO-CL', 'RO-DB', 'RO-GR', 'RO-IF', 'RO-IL', 'RO-PH', 'RO-TR', 'RO-DJ', 'RO-GJ', 'RO-MH', 'RO-OT', 'RO-VL'],
        },
      },
    ],
  },

  /* -------------------------------------------------------------- Elsewhere */

  AUS: {
    note:
      'The six states and three mainland territories. Natural Earth draws Lord Howe Island ' +
      'and Macquarie Island as units of their own; they are part of New South Wales and Tasmania.',
    levels: {
      states: {
        name: 'States and territories',
        kind: 'State',
        code: 'ST',
        adminLevel: 'ADM1',
        group: { absorb: { 'AUS-2654': ['AUS-2659'], 'AUS-2660': ['AU-X03~'] } },
      },
    },
    curated: 'states',
    kinds: { 'AU-X02~': 'Territory', 'ATC+00?': 'External territory' },
  },

  IND: {
    note: 'States and union territories, current since 2020.',
    kinds: { 'IN-HP': 'State', 'IN-GJ': 'State' },
  },

  PAK: {
    note: 'The Federally Administered Tribal Areas joined Khyber Pakhtunkhwa in 2018.',
    levels: {
      provinces: {
        name: 'Provinces and territories',
        kind: 'Province',
        code: 'P',
        adminLevel: 'ADM1',
        vintage: 2018,
        group: { absorb: { 'PK-KP': ['PK-TA'] }, names: { 'PK-KP': { name: 'Khyber Pakhtunkhwa' } } },
      },
    },
    curated: 'provinces',
  },

  VNM: {
    note:
      'The 34 provincial units in force since 1 July 2025 (Resolution 202/2025/QH15): 23 ' +
      'formed by merging whole provinces, 11 unchanged. Maximum shows the 63 before it.',
    levels: {
      provinces: {
        name: 'Provinces (2025)',
        kind: 'Province',
        code: 'P25',
        adminLevel: 'ADM1',
        vintage: 2025,
        group: {
          rest: 'self',
          table: {
            TQ: { name: 'Tuyên Quang', members: ['VN-07', 'VN-03'] },
            LC: { name: 'Lào Cai', members: ['VN-02', 'VN-06'] },
            TN: { name: 'Thái Nguyên', members: ['VN-69', 'VN-53'] },
            PT: { name: 'Phú Thọ', members: ['VN-68', 'VN-70', 'VN-14'] },
            BN: { name: 'Bắc Ninh', members: ['VN-56', 'VN-54'] },
            HY: { name: 'Hưng Yên', members: ['VN-66', 'VN-20'] },
            HP: { name: 'Haiphong', local: 'Hải Phòng', kind: 'Municipality', members: ['VN-HP', 'VN-61'] },
            NB: { name: 'Ninh Bình', members: ['VN-18', 'VN-63', 'VN-67'] },
            QT: { name: 'Quảng Trị', members: ['VN-25', 'VN-24'] },
            DN: { name: 'Da Nang', local: 'Đà Nẵng', kind: 'Municipality', members: ['VN-DN', 'VN-27'] },
            QNG: { name: 'Quảng Ngãi', members: ['VN-29', 'VN-28'] },
            GL: { name: 'Gia Lai', members: ['VN-30', 'VN-31'] },
            KH: { name: 'Khánh Hòa', members: ['VN-34', 'VN-36'] },
            LD: { name: 'Lâm Đồng', members: ['VN-35', 'VN-72', 'VN-40'] },
            DL: { name: 'Đắk Lắk', members: ['VN-33', 'VN-32'] },
            SG: { name: 'Ho Chi Minh City', local: 'Thành phố Hồ Chí Minh', kind: 'Municipality', members: ['VN-SG', 'VN-57', 'VN-43'] },
            DNA: { name: 'Đồng Nai', members: ['VN-39', 'VN-58'] },
            TNI: { name: 'Tây Ninh', members: ['VN-37', 'VN-41'] },
            CT: { name: 'Can Tho', local: 'Cần Thơ', kind: 'Municipality', members: ['VN-CT', 'VN-52', 'VN-73'] },
            VL: { name: 'Vĩnh Long', members: ['VN-49', 'VN-50', 'VN-51'] },
            DT: { name: 'Đồng Tháp', members: ['VN-45', 'VN-46'] },
            CM: { name: 'Cà Mau', members: ['VN-59', 'VN-55'] },
            AG: { name: 'An Giang', members: ['VN-44', 'VN-47'] },
          },
        },
      },
    },
    ne: { name: 'Provinces (until 2025)', kind: 'Province' },
    kinds: { 'VN-HN': 'Municipality', 'VN-26': 'Municipality' },
    curated: 'provinces',
    maximum: 'ne',
  },

  PHL: {
    note: 'The 17 regions instead of 118 provinces and highly urbanised cities.',
    levels: {
      regions: {
        name: 'Regions',
        kind: 'Region',
        code: 'REG',
        adminLevel: 'ADM1',
        vintage: 2020,
        group: { within: gb('PHL', 'ADM1') },
      },
    },
    ne: { name: 'Provinces and cities', kind: 'Province' },
    curated: 'regions',
  },

  LKA: {
    note: 'The nine provinces instead of 25 districts.',
    levels: {
      provinces: {
        name: 'Provinces',
        kind: 'Province',
        code: 'P',
        adminLevel: 'ADM1',
        group: {
          key: 'region_cod',
          names: {
            'LK-1': { name: 'Western Province', code: 'LK-1' },
            'LK-2': { name: 'Central Province', code: 'LK-2' },
            'LK-3': { name: 'Southern Province', code: 'LK-3' },
            'LK-4': { name: 'Northern Province', code: 'LK-4' },
            'LK-5': { name: 'Eastern Province', code: 'LK-5' },
            'LK-6': { name: 'North Western Province', code: 'LK-6' },
            'LK-7': { name: 'North Central Province', code: 'LK-7' },
            'LK-8': { name: 'Uva Province', code: 'LK-8' },
            'LK-9': { name: 'Sabaragamuwa Province', code: 'LK-9' },
          },
        },
      },
    },
    ne: { name: 'Districts', kind: 'District' },
    curated: 'provinces',
  },

  NPL: {
    note: 'The seven provinces of the 2015 constitution. Natural Earth still draws the 14 zones they replaced.',
    levels: {
      provinces: {
        name: 'Provinces',
        kind: 'Province',
        code: 'P',
        adminLevel: 'ADM1',
        vintage: 2020,
        split: { base: 'country', source: gb('NPL', 'ADM1') },
      },
    },
    curated: 'provinces',
    maximum: 'provinces',
  },

  KEN: {
    note: 'The 47 counties of the 2010 constitution. Natural Earth still draws the 8 provinces they replaced in 2013.',
    levels: {
      counties: {
        name: 'Counties',
        kind: 'County',
        code: 'CO',
        adminLevel: 'ADM1',
        vintage: 2020,
        split: { base: 'ne', source: gb('KEN', 'ADM1') },
      },
    },
    ne: { name: 'Former provinces', kind: 'Former province' },
    curated: 'counties',
  },

  UGA: {
    note: 'The four regions instead of 112 districts.',
    levels: {
      regions: { name: 'Regions', kind: 'Region', code: 'R', adminLevel: 'ADM1', group: { key: 'region' } },
    },
    ne: { name: 'Districts', kind: 'District' },
    curated: 'regions',
  },

  MWI: {
    note: 'The three regions instead of 28 districts.',
    levels: {
      regions: { name: 'Regions', kind: 'Region', code: 'R', adminLevel: 'ADM1', group: { within: gb('MWI', 'ADM1') } },
    },
    ne: { name: 'Districts', kind: 'District' },
    curated: 'regions',
  },

  BFA: {
    note: 'The 13 regions instead of 45 provinces.',
    levels: {
      regions: { name: 'Regions', kind: 'Region', code: 'R', adminLevel: 'ADM1', group: { key: 'region' } },
    },
    ne: { name: 'Provinces', kind: 'Province' },
    curated: 'regions',
  },

  GIN: {
    note: 'The seven regions and Conakry instead of 34 prefectures.',
    levels: {
      regions: {
        name: 'Regions',
        kind: 'Region',
        code: 'R',
        adminLevel: 'ADM1',
        group: { key: 'region', names: { Boke: 'Boké', Conakry: { name: 'Conakry', kind: 'Special zone' } } },
      },
    },
    ne: { name: 'Prefectures', kind: 'Prefecture' },
    curated: 'regions',
  },

  JAM: {
    note: 'Jamaica’s three historic counties instead of 14 parishes.',
    levels: {
      counties: {
        name: 'Counties',
        kind: 'County',
        code: 'CO',
        group: {
          table: {
            CORNWALL: { name: 'Cornwall', members: ['JM-09', 'JM-11', 'JM-08', 'JM-07', 'JM-10'] },
            MIDDLESEX: { name: 'Middlesex', members: ['JM-13', 'JM-12', 'JM-06', 'JM-14', 'JM-05'] },
            SURREY: { name: 'Surrey', members: ['JM-01', 'JM-04', 'JM-02', 'JM-03'] },
          },
        },
      },
    },
    ne: { name: 'Parishes', kind: 'Parish' },
    curated: 'counties',
  },

  TTO: {
    note: 'Trinidad and Tobago as its two islands.',
    levels: {
      islands: {
        name: 'Islands',
        kind: 'Island',
        code: 'I',
        group: { rest: 'TRI', table: { TRI: { name: 'Trinidad', members: [] }, TOB: { name: 'Tobago', members: ['TT-ETO', 'TT-WTO'] } } },
      },
    },
    ne: { name: 'Regional corporations and municipalities', kind: 'Municipality' },
    curated: 'islands',
  },

  MUS: {
    note: 'Mauritius, Rodrigues and Agaléga, which lie hundreds of kilometres apart.',
    levels: {
      islands: {
        name: 'Islands',
        kind: 'Island',
        code: 'I',
        group: {
          rest: 'MU',
          table: {
            MU: { name: 'Mauritius', members: [] },
            RO: { name: 'Rodrigues', kind: 'Autonomous island', members: ['MU-RO'] },
            AG: { name: 'Agaléga', kind: 'Outer island', members: ['MU-AG'] },
          },
        },
      },
    },
    curated: 'islands',
  },

  CPV: {
    note: 'The Barlavento and Sotavento island groups instead of 22 municipalities.',
    levels: {
      groups: {
        name: 'Island groups',
        kind: 'Island group',
        code: 'IG',
        group: {
          key: 'region',
          names: { 'Ilhas de Barlavento': 'Barlavento Islands', 'Ilhas de Sotavento': 'Sotavento Islands' },
        },
      },
    },
    curated: 'groups',
  },

  BHS: {
    note: 'One unit: 30 districts across 13,900 km² of land are specks at world scale.',
    curated: 'country',
  },
}
