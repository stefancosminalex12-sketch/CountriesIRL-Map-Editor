/**
 * Historical and regional flags, beyond the ISO country set.
 *
 * These exist so a merged entity can fly something other than a modern national flag:
 * an "Iberia" or a "Danubia" is not a country and has no ISO code, and the point of
 * naming one is usually that it corresponds to something historical.
 *
 * Every file is the Wikimedia Commons asset named in `source`, fetched through
 * `Special:FilePath` and stored verbatim in `assets/flags/`. Nothing here is drawn or
 * approximated by hand — a flag is a historical artefact, and an invented one is
 * misinformation with a nice gradient. The `source` field is what a later reader needs
 * to check any of them against the original.
 *
 * Codes are prefixed `x-` so they can never collide with an ISO 3166-1 alpha-2 code,
 * present or future.
 */
export const HISTORICAL_FLAGS = [
  { code: 'x-rome', name: 'Roman Empire', source: 'Flag_of_Roman_Empire-Rectangular.svg' },
  { code: 'x-yug', name: 'Yugoslavia', source: 'Flag_of_Yugoslavia_(1946-1992).svg' },
  { code: 'x-ussr', name: 'Soviet Union', source: 'Flag_of_the_Soviet_Union.svg' },
  { code: 'x-qing', name: 'Qing Dynasty', source: 'Flag_of_the_Qing_Dynasty_(1889-1912).svg' },
  { code: 'x-brit', name: 'British Empire', source: 'Flag_of_the_United_Kingdom_(3-5).svg' },
  { code: 'x-scot', name: 'Scotland', source: 'Flag_of_Scotland.svg' },
  { code: 'x-wales', name: 'Wales', source: 'Flag_of_Wales.svg' },
  { code: 'x-nire', name: 'Northern Ireland', source: 'Ulster_Banner.svg' },
  { code: 'x-mold', name: 'Moldavia', source: 'Flag_of_Moldavia.svg' },
  { code: 'x-tran', name: 'Transylvania', source: 'Flag_of_Transylvania_before_1918.svg' },
  { code: 'x-austria', name: 'Austrian Empire', source: 'Flag_of_the_Habsburg_Monarchy.svg' },
  {
    code: 'x-rusemp',
    name: 'Russian Empire',
    source: 'Flag_of_the_Russian_Empire_(black-yellow-white).svg',
  },
  { code: 'x-ah', name: 'Austria-Hungary', source: 'Flag_of_Austria-Hungary_(1869-1918).svg' },
]
