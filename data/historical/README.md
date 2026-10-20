# Historical world maps

`world-1914.json`, `world-1938.json`, `world-1945.json` and `world-1990.json` (TopoJSON, object
`countries`), each with a `-meta.json` entity table in the modern map's format, cut into the
modern map's 25m land; and the same years cut into its 10m land, `world-1914-10m.json` and so on,
whose borders stay curved when zoomed in. Built by `scripts/historical/build-historical.mjs`
(`--detail=10m` for the second set); `report.json` and `report-10m.json` are the builds' reports.

The Europe Countries map opens the same files for Europe 1914, 1938 and 1945 (`EUROPE_YEARS` in
`src/maps/atlas.ts`), framed on Europe: one set of borders and corrections for both maps.

## Sources and licence

- **Borders of 1914, 1938 and 1945:** OpenHistoricalMap (openhistoricalmap.org), public domain
  (CC0): the administrative-level-2 relations valid on 1 July 1914, 31 December 1938 and
  31 December 1945, fetched by `scripts/historical/ohm.mjs` and simplified to 0.4 km. Its
  borders are traced from topographic maps, so they follow rivers and ridges.
- **Land OpenHistoricalMap leaves uncovered** (a colony it has not drawn yet, such as part of
  Italian Somaliland) is filled from Andrés Ourednik, *historical-basemaps*
  (github.com/aourednik/historical-basemaps), GNU GPL v3, and only where at least 300 km² and
  6 km wide is uncovered. Because of that fill these three maps are **GPL v3**: see `LICENSE`.
- **Land, coasts and islands:** Natural Earth 25m admin-0 (public domain), the modern World map's
  own. The historical borders are cut into it, so a historical map has the modern map's coastline.
- **Outlines no historical map draws** — the Kars provinces (Russian 1878–1918), the Hatay State,
  Papua, Libreville's coast — are Natural Earth 10m admin-1 provinces (public domain).
- **1990** is the modern map's own countries, joined and named as they were at the end of 1990:
  Natural Earth only, public domain.

## Corrections

OpenHistoricalMap's names are its own ("French Republic", "British Military Administration of
Libya"); `build-historical.mjs` maps them to the names the World map uses, and splits land a
country holds overseas into the colony it was (Suriname out of the Netherlands, Papua out of
Australia). The fill's names, and a number of its borders, are not of the year. `scripts/historical/curation.mjs`
lists every correction with its reason: names and colonial rulers, units dropped, units carved from
another year's outline (the Kingdom of Yemen of 1938 from 1945's), overlaps settled, and land moved
within one modern country (the source's 1938 Turkey is the Treaty of Sèvres one; its 1914 Bulgaria
has Edirne). The build also gives a neighbour's thin strips along a modern border, where the coarse
source draws an unchanged border a few kilometres off, to the country they lie in.

Where two countries' outlines run a few metres apart — OpenHistoricalMap draws some borders once
for each side, simplified differently — the border would be drawn as two coasts, or not at all.
`scripts/historical/heal.mjs` makes them one line: on edges no other outline shares it takes out
needle-thin spikes and puts in the other side's points within 15 m. A strip set aside during a cut
is also no longer handed out twice (it made two countries overlap). Checked with a border audit
(`.cache/hist-tools/audit.mjs`): at 10m no undrawn border in Europe in any year; at 25m two spikes
under 3 km remain (Bohumín 1938, the Luxembourg–French zone border 1945).

The build fails if a unit of the year is missing from its map, or if a unit's joined area is not
the sum of its pieces (a merge across a pinched ring once took most of the United States for
holes).
