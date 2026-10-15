# Historical world maps

`world-1914.json`, `world-1938.json`, `world-1945.json` and `world-1990.json` (TopoJSON, object
`countries`), each with a `-meta.json` entity table in the modern map's format. Built by
`scripts/historical/build-historical.mjs`; `report.json` is that build's report.

## Sources and licence

- **Borders of 1914, 1938 and 1945:** Andrés Ourednik, *historical-basemaps*
  (github.com/aourednik/historical-basemaps), GNU GPL v3. The 1930 map of the same project
  supplies East Prussia and Danzig for 1938. These three maps are derived from it and are
  therefore **GPL v3** as well: see `LICENSE`.
- **Land, coasts and islands:** Natural Earth 25m admin-0 (public domain), the modern World map's
  own. The historical borders are cut into it, so a historical map has the modern map's coastline.
- **Outlines no historical map draws** — the Kars provinces (Russian 1878–1918), the Hatay State,
  Papua, Libreville's coast — are Natural Earth 10m admin-1 provinces (public domain).
- **1990** is the modern map's own countries, joined and named as they were at the end of 1990:
  Natural Earth only, public domain.

## Corrections

The source's names, and a number of its borders, are not of the year. `scripts/historical/curation.mjs`
lists every correction with its reason: names and colonial rulers, units dropped, units carved from
another year's outline (the Kingdom of Yemen of 1938 from 1945's), overlaps settled, and land moved
within one modern country (the source's 1938 Turkey is the Treaty of Sèvres one; its 1914 Bulgaria
has Edirne). The build also gives a neighbour's thin strips along a modern border, where the coarse
source draws an unchanged border a few kilometres off, to the country they lie in.

The build fails if a unit of the year is missing from its map, or if a unit's joined area is not
the sum of its pieces (a merge across a pinched ring once took most of the United States for
holes).
