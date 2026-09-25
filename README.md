# Map Editor — prototype

Browser-based map editor for content creators. Real geographic vector data as the
foundation, with the author free to give any country any value or colour they want.

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` type-checks and builds; `npm run typecheck` runs TypeScript alone.
Both `dev` and `build` first run `scripts/prepare-data.mjs`, which copies the
geographic datasets into `public/geo/` and derives the ISO country table.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Vite + React + TypeScript | fast dev loop, no framework ceremony |
| Geography | Natural Earth, current edition, curated by `scripts/build-geography.mjs` into one TopoJSON foundation for every map | real vector polygons, public domain, no API key, no usage cost |
| Country identity | `world-countries` → ISO 3166-1 | stable alpha-3 ids, region/subregion grouping |
| Projection / paths | `d3-geo` | projection registry, `fitExtent`, path generation |
| Extended projections | `d3-geo-projection` | Robinson, Winkel Tripel, Nell–Hammer |
| Pan / zoom | `d3-zoom` | standard, composable with SVG transforms |
| Rendering | SVG | one path per country; the same output serialises to SVG and rasterises to PNG |
| State | `zustand` | small store, no boilerplate |

## Architecture

```
src/
  types/map.ts        MapDocument — the serialisable source of truth
  geo/
    datasets.ts       dataset registry + loader (modern world = one dataset)
    countryMeta.ts    ISO code / name / region table
    supplemental.ts   geometry for entities a dataset cannot describe
    lowDetailGeometry.ts     generated shapes for entities a coarse layer omits
    lakes.ts          inland water — an independent geographic layer
    repair.ts         ring hygiene shared by every geographic layer
    metrics.ts        per-country area + representative point (small-entity rule)
    regions.ts        region membership + framing policy + multi-region composition
    framing.ts        geometry-derived camera bounds (outlier rejection)
    projections.ts    projection registry
    fit.ts            resolved framing + viewport -> configured projection
  state/
    defaults.ts       blank document factory, built-in palettes
    operations.ts     the MapOperation vocabulary + what is undoable
    palettes.ts       sequential ramps: blue/red/green at 6 and 9 steps
    executor.ts       validate + apply operations (pure)
    colors.ts         country fill resolution pipeline
    mapStore.ts       store; document changes only via dispatch()
  render/
    MapCanvas.tsx     SVG renderer, zoom, hit-testing
    smallEntities.ts  assisted hit targets + selection markers for tiny features
  theme/themes.ts     three themes: UI tokens + map palette
  state/settingsStore.ts  theme + selection highlight, persisted to localStorage
  ui/                 sidebar, region selector, inspector, settings, status bar
```

### Rules worth preserving

1. **Everything that changes the document goes through an operation.**
   `dispatch(ops)` validates then applies. The UI uses it; the AI assistant will use
   the same path and nothing else. It never touches React state or the renderer.

2. **The document is serialisable and renderer-agnostic.** Nothing in `types/map.ts`
   or `state/` imports React.

3. **The modern world is a dataset, not the geography.** Historical periods register
   in `DATASETS` with the same shape. Authored country data survives a dataset swap
   because it is keyed by country id, not by geometry.

4. **One feature per stable country id.** The loader groups source geometries by id
   (Natural Earth 50m ships Australia as two geometries). Every country is one
   addressable unit for styling, hit-testing and future geometry edits.

   The loader also repairs source rings, which matters from 10m onwards. Natural
   Earth's TopoJSON quantises longitude to ~0.0036° (about 400 m), and 10m contains
   islets smaller than that step, so their rings collapse to two or three distinct
   corners. d3-geo cannot derive an orientation for such a ring; three Maldivian ones
   came back wound the wrong way, which the spherical clipper read as "this polygon
   covers the globe" and painted as the entire projection outline. So the loader
   drops rings with fewer than three distinct corners, and reverses the outer ring of
   any polygon whose spherical area exceeds half the globe. A country left with no
   geometry at all (Vatican City at 10m, 0.49 km²) is omitted rather than kept as a
   feature that can never be drawn or clicked.

   Do not remove this step: without it the 10m world map renders as one filled oval.
   It is a no-op for 50m and drops a single invisible sliver at 110m.

   Countries the source cannot describe come from `supplemental.ts`, kept separate
   from the Natural Earth files, in one of two modes.

   `fallback` fills a gap: used only where the dataset produced no usable polygon, so
   nothing is ever drawn twice. Vatican City is the one `replace` entry: Natural Earth's
   own Vatican is a seven-point placeholder a tenth of the state's width, so the traced
   outline is used at every resolution and on both world maps — see *Vatican City* under
   *No minimum rendered size*.

   Most gaps are not about quantisation but about editorial scope: world-atlas ships
   the same countries at three resolutions and the coarser two leave out whatever is
   too small to draw. The 110m layer names 177 of the 254 entities this app knows and
   the 50m layer 240, so on the 110m map Monaco, Malta, Singapore, Hong Kong, Bermuda
   and 72 others simply did not exist. `lowDetailGeometry.ts` closes that gap for all
   77, and is generated rather than hand-kept: an entity is there because a layer has
   no geometry for it, and would leave again if a future dataset supplied one. See
   *Entities a coarse dataset omits* below.

   `replace` overrides geometry that exists but is incomplete. It was used for Bahrain,
   whose archipelago the older `world-atlas` country layer merged down to its main
   island; the curated foundation (see *The geographic foundation* below) is built
   from Natural Earth's current admin-0, which draws all seven of its polygons, so no
   replacement is needed any more.

   A supplement declares which resolutions it applies to, so 10m coastlines never
   leak into the 110m map — every low-detail fallback is scoped to the
   resolutions that actually lack the entity. Source geometry always wins where it
   exists: Hong Kong, Macau, Singapore and Malta are supplemented at 110m and come
   from the dataset at 50m and 10m, untouched.

5. **Regions compose.** `resolveFraming(['europe','asia'])` produces one Eurasia
   framing. There is no hardcoded combined preset, and the antimeridian is handled by
   shifting windows by whole turns.

6. **Fitting never distorts.** `fitExtent` applies a uniform scale; the composition
   is cropped to the region, never stretched.

7. **Region membership and camera framing are separate questions.** A country can
   belong to a region while some of its geometry has no business deciding where the
   map's edges are — Norway is in Europe, but Svalbard sits 1500 km north of the
   mainland. `regions.ts` answers "what belongs here"; `framing.ts` answers "what
   should the camera fit". See below.

### Maps, and the atlas abstraction

The editor opens more than one map. **World** draws the world's countries; **USA States**
draws the fifty states, DC, the territories and the Minor Outlying Islands. Choosing between them is a subsection of Map, and it is meant to
feel like changing the dataset inside one editor rather than opening a second application
— because that is what it is.

An **atlas** (`maps/atlas.ts`) is a thin description: its datasets, its regions, what one
of its entities is called, and any inset layout its geography needs. Nothing downstream
knows atlases exist. Selection, values, palettes, thresholds, comparison, merging, flags,
the legend, the composition frame and export all read *entities*, and they read them the
same way whether the entity is France or Nevada. Adding Canadian provinces later should be
a dataset, an entity table and an entry in that file.

**Identifiers are namespaced by construction**, which is what makes the whole thing safe.
Countries are ISO 3166-1 alpha-3 (`USA`), states and territories are ISO 3166-2 (`US-CA`,
`US-PR`), and the Minor Outlying Islands ISO 3166-2:UM (`UM-79`). No two atlases
can mint the same id, so two documents can be held side by side with no risk that a value
written against California is read as one written against a country.

**The entity table has one shape.** A country and a state are both a name, a short code
and a place in a hierarchy; what differs is the values, not the fields. `iso2` is
deliberately nullable and means only "the ISO 3166-1 country code" — it is the key the
flag library is indexed on, so a state carries `null` rather than a stand-in that would
ask for artwork that cannot exist. Its own identifier is `code` (`CA`), and `region` /
`subregion` carry the US Census region and division, which is what those words honestly
mean for a state. The type is `EntityId`; `CountryId` remains as an alias, because every
field and operation that says "country" has always held an entity id and renaming several
hundred references would change no behaviour while losing the reader's place in the
history. What matters is that nothing *assumes* the entity is a country, and that is a
property of the code rather than of the identifier's name.

**Each map owns its own work.** Switching parks the outgoing document, its undo stack and
its selection, and restores the target's; going World to USA States and back returns the
world map exactly as it was left, undo included. What crosses the boundary is the small
set of things that belong to the *editor* rather than to a map — the theme colours, the
display switches, the composition frame — because those are how the author likes to work.
Measured: values set on France and Germany survived a detour through the states map, the
states' own values survived the return trip, and neither map ever saw the other's.

#### Territories and outlying islands

USA States draws the territories the way it draws a state: one entity each, selected,
coloured, named, merged and exported like Nevada. The fifty states and DC are Natural
Earth's, as before.

- **Puerto Rico, the U.S. Virgin Islands, Guam, the Northern Mariana Islands and American
  Samoa** (`US-PR`, `US-VI`, `US-GU`, `US-MP`, `US-AS`) are the Census Bureau's polygons from
  `cb_2024_us_state_500k` — the file, and the polygons, the Official USA Administrative Map's
  States level draws. That map divides them into municipios, districts and islands; this one
  keeps each whole. Each carries its GEOID, FIPS codes and land and water area, which the
  inspector shows.
- **The Minor Outlying Islands** — `UM-81` Baker, `UM-84` Howland, `UM-86` Jarvis, `UM-67`
  Johnston, `UM-71` Midway, `UM-95` Palmyra, `UM-79` Wake and `UM-76` Navassa — are in no
  Census file. Their shorelines are the USGS Global Islands database, version 3 (Sayre 2023,
  doi:10.5066/P91ZCSGM), traced from 30 m Landsat imagery, every islet of an atoll included.
  The build asks its feature service for each island by a box around it, and stops if a
  polygon reaches outside the box. An islet smaller than the topology's grid (about 335 m² at
  Midway, where most of the source's 303 sand and rubble islets are) cannot be drawn by it —
  quantised, its ring collapses to a point that d3 would read as a ring round the rest of the
  globe — so it is left out, and the report counts how many per island. **Kingman Reef is not
  drawn**: it is a reef awash, the source has no dry land there, and any shape for it would be
  invented. The build report lists it as omitted.
- **Insets** put the territories where the Official USA Administrative Map puts them
  (American Samoa a little lower, clear of Texas), plus Navassa between Florida and Puerto
  Rico, and the Pacific's remote islands, in their true relation to one another, below the
  Gulf coast — the one open stretch that stays open on a phone's narrow canvas, where the
  Pacific coast has no room beside California. None of the outlying islands is ten
  kilometres across, so at an inset's scale each is a speck drawn at its true size, growing
  as the camera zooms in, and is selected through its click catchment. The magnifier and the
  catchments are measured through the inset that draws the entity, so they sit on it.

Rebuilding: `npm run build-geography` (fetches the Census file and the island polygons into
`.cache/` once).

#### Alaska and Hawaii

Alaska is 3,000 km from the contiguous states and reaches across the antimeridian; Hawaii
is 4,000 km out into the Pacific. Fitting one projection to all fifty states spends the
canvas on ocean and leaves the part anyone came to look at the size of a stamp. Every
printed atlas solves this the same way and so does this one: the lower 48 are the map, and
the other two are drawn beside it at their own scale.

**The framing needed no new mechanism.** The USA region's `domain` is the contiguous
window, and geography outside a domain has always been rendered but excluded from the
camera — the same rule that stops Svalbard deciding where the top of a map of Europe is.
Alaska simply stops voting on the frame.

**An inset is a viewport, not a geometry edit.** The states keep their real coordinates
and are drawn from them; what changes is which projection puts them on screen. Each inset
gets its own conic — Alaska rotated to 154°W on parallels 55/65, Hawaii to 157°W on 8/18,
the same parameters d3's own `geoAlbersUsa` uses — because the main map's projection is
wrong for them by construction: one centred on Kansas tears Alaska in half at the
antimeridian, and no SVG transform applied afterwards could put it back together.

Scale is a **multiple of the main projection's**, not a fit to a box: Alaska is drawn at
0.3x and Hawaii at 1x, so the relationship stays honest and constant at every viewport
size instead of being an accident of how much room each box had. Placement is one
assignment — a projection's centre lands on its translate — so the anchor cannot drift.
The frame clips: the Aleutian chain and Hawaii's northwestern islands out to Kure are
still drawn from their real coordinates and simply fall outside the box, exactly as on a
printed map. Measured: 40% of Alaska's frame is ink and **0%** spills past its right edge.

The load-bearing consequence is that **there is one shape list, not two**. An inset entity
differs from a main-map one in exactly two ways — which projection produced its path, and
that it carries a clip — and both are settled where the paths are built. Everything after
that point sees a flat list and treats Alaska as it treats Kansas. So the insets are not
decorations: selection, hover, values, palettes, thresholds, comparison groups, merging,
assigned flags, the legend and export reach them without a single special case.

Verified on the states map: California and Nevada select and multi-select; Alaska and
Hawaii select too and take the theme highlight; four states including both inset states
took values and drew four distinct steps of the ramp with the rest left as plain land;
Compare put California and Texas in one group and New York and **Alaska** in the other,
each pair sharing a colour; the threshold preset applied; California + Nevada + Arizona
merged into one dissolved body that hit-tests as itself, takes a value and paints with it,
and restores its members when deleted; states with no flag of their own were assigned
artwork directly and rendered distinct patterns; and Mercator, Equal Earth and Albers all
drew the map with both insets intact. The SVG export carries 53 real vector paths —
Alaska's alone is 1.5 MB of path data — with both inset clips, and no sidebar.

**The world map is unchanged**, which was the other half of the job. Re-audited after the
refactor: 254 countries at all three resolutions, all seven regions framing from geometry,
the data palette, 265 flag patterns, merge-and-restore, and an export with 256 paths, no
inset clips and no sidebar. An atlas with no insets computes nothing for them and takes
exactly the path it always did.

**The data** is the 51 US entities of the curated admin-1 set, cut out by
`scripts/build-geography.mjs` — so the states map inherits every correction the
administrative world gets, islands included — and vendored as their own topology: the
whole-world file is 40 MB and the app should not download Bavaria to draw Nevada. It is
TopoJSON rather than GeoJSON, and that is a capability rather than a
storage detail: shared arcs are what `mesh` reads to find the boundary between two states
and nothing else, and what `topojson.merge` dissolves when states are merged. 520 arcs,
and a CA+NV+AZ dissolve drops from 2,475 vertices to 1,887.

#### Modern Administrative World

A third atlas: the modern world by region — each country drawn at the level of subdivision
that suits it — rather than by country. It is a separate map with its own document, and the
World map it sits beside is unchanged and still what the editor opens on.

**Not one administrative level everywhere.** "First-level subdivision" means Germany's 16
Länder and Slovenia's 193 municipalities alike, so a map drawn at that level is coarse in one
place and fragmented in the next. Which level each country uses is decided country by country
in one editable table, `scripts/admin/countries.mjs`, with the reason written beside it:

| | Curated Default | More Detailed | Maximum |
|---|---|---|---|
| Germany | 38 Regierungsbezirke (NUTS 2) | 401 Kreise | 401 Kreise |
| France | 101 departments | 325 arrondissements | same |
| United Kingdom | 12: England's regions + Wales, Scotland, N. Ireland | 170 counties and unitary authorities | 232 local authorities |
| Slovenia · Latvia | 12 · 6 statistical regions | 12 · 43 municipalities (2021) | 193 · 43 |
| N. Macedonia · Kosovo · Azerbaijan | 8 · 7 · 14 regions | same | 84 · 30 · 78 |
| Andorra, Liechtenstein, Malta… | one unit (Malta: Malta and Gozo) | same | parishes, councils |
| Romania, Bulgaria, Greece, Spain, Italy, Poland | counties, provinces, regions — Natural Earth's own | same | same |
| Kenya · Nepal · Vietnam | 47 counties · 7 provinces · 34 provinces (2025) | same | · · 63 before 2025 |

Curated Default has 3,153 units, More Detailed 4,030, Maximum 5,257 (Natural Earth alone
has 4,596). Countries smaller than 3,000 km² are one unit unless the table keeps their island
groups apart.

**Odesa Oblast is two units.** It is divided along the Dniester and its estuary, the water
that all but reaches Moldova. North of it the oblast keeps its Natural Earth id (`UKR-322`),
name and code, so values an older map gave it stay with it. South of it is the **Budjak**
(`UKR-OB-budjak`, a historical region inside Ukraine), the southern end of Bessarabia and part
of Moldavia until 1812: the nine raions that lie there in geoBoundaries' raion layer (2006
boundaries), 12,561 km² of the oblast's 33,085. `split.only` confines the cut to that one
oblast and `split.join` gathers the raions into one piece; the rest is the oblast less that
piece, not the union of its own raions, so the cut line is the only new line.

**The Budjak ends at the water.** `split.stopAt` cuts the Budjak along Natural Earth's own
Dniester estuary, the lake the map draws, and the river's own line. The river runs down the
estuary and out through its mouth, which parts the Zatoka spit (Budjak) from the eastern bank.
The estuary, the delta at its head and the eastern bank belong to northern Odesa.

This needed fixing because the raion layer leaves the estuary and much of the eastern bank
uncovered, and the split had handed that uncovered land to the Budjak, so it wrapped round the
estuary. Now only land the river cuts off moves: 148 km², the eastern bank and the delta. A
scrap of the western shore pinched off by an inlet stays with the Budjak, and nothing is added
to it.

The Budjak's edge is the lake's own shoreline, so the region boundary and the water the map
draws agree. The estuary is still land beneath the lake in northern Odesa's outline, as it was
before the split, and the lake is drawn over it exactly as before. Every other
Ukrainian oblast, and every unit of every other country's fragments, decodes to the same
coordinates as before. Moldova's South (and Ștefan Vodă at the finer level) gains two
vertices on its existing border line: the cut's end at Palanca, and one point the Budjak and
Moldova share 111 m from an existing vertex. Quantisation moves them by at most 23 m, and the
region's area by 0.03 km².

**Real boundaries only.** Every unit is either Natural Earth's own, a dissolve of Natural
Earth units into an official coarser division (Slovenia's statistical regions, England's ITL 1
regions, Azerbaijan's economic regions of the 2021 decree), or an official finer division from
geoBoundaries' gbOpen release cut into Natural Earth's outline (Germany's BKG districts,
France's IGN arrondissements, Kenya's counties). A dissolved unit lists the units it was made
from. Only geoBoundaries layers under attribution-only licences are used as geometry; the
credit for each — agency, year, licence — is built into the data and shown in Settings → Data
sources.

**Natural Earth stays the outline.** A cut keeps the unit's coast and borders exactly as
Natural Earth draws them, so the administrative map has the World map's coastline, islands,
lakes and international borders, vertex for vertex. Where the finer source's outline strays
from Natural Earth's, the strip between them goes to the finer unit it borders. The engine
(`scripts/admin/build-admin.mjs`) clips on Clipper at 2 cm, records every point a cut
creates, and puts each on every ring that runs along the same line, so a border two units
share is one arc again.

**Regions a user can select whole.** Every unit carries the regions it lies in — its
autonomous community, its region, the coarser levels of its own country, and a few historical
regions the table records (Romania's, county-based and marked approximate). The Selection
panel's region search and the inspector's "Select the whole region" add them to the
selection: Catalonia is its four provinces on the curated map, Transylvania its ten counties.

**Three levels, loaded as needed.** The build writes the curated map as one topology
(`public/geo/admin/base.json`) and each country another level changes as a fragment of its
own, carrying only the arcs the base lacks. Map → Detail loads the base once and the fragments
that level needs (`src/geo/composition.ts`); the result is an ordinary topology to everything
downstream. A unit whose land is the same at two levels keeps its id at both, so values
survive switching; one that exists only at another level waits in the document.

**Checked on every build** (`data/admin/report.json`): each Natural Earth polygon, islands
included, lies in exactly one unit at every level; ids are unique; and every level composes to
Natural Earth's own coastline and national borders, with any arc that does not reported by
kind, length and place. As built: no gaps, no overlaps, no national border lost at any level,
and 3–7 short coastal arcs (under 7 km in all, in Kenya, France and Germany) left over.

**The ids** are Natural Earth's `adm1_code` wherever a unit is Natural Earth's unit unchanged
(`FRA-2000`), made safe for any attribute (`VAT+00?` → `VAT_00_`); a unit made of several is
`ISO3-LEVEL-code` (`SVN-SR-SI041`, `DEU-RB-oberbayern`). All are clear of both other atlases'
namespaces.

Rebuilding: `npm run build-geography` builds everything; `node --max-old-space-size=8192
scripts/admin/build-admin.mjs` rebuilds only the administrative levels from the cached units.

**Vatican City is there.** It is one subdivision in the source (`VAT+00?`, `VAT_00_` on the
map, where the few Natural Earth ids with punctuation are made safe for any attribute), and its ring
collapses to two corners under the same quantisation that loses it from the country map —
so it used to be the one subdivision the map dropped. It is supplied exactly as the World
map supplies it: the country's supplemental outline (`geo/supplemental.ts`) becomes its
only subdivision's, a rule that applies to any country that is a single entity on this map
and never to one divided into several. From there it is an ordinary small entity — its real
shape at its real position, painted after Rome, drawn six times its true size (the one
entity that is — see *No minimum rendered size*) and given an assisted catchment, so it can
be seen and hit without anything around it changing.

**Every subdivision knows its country.** `prepare-data.mjs` builds the entity table from
the source's own fields and resolves each subdivision's parent against the world map's
country table — including Natural Earth's codes for places ISO spells differently (`KOS`,
`SDS`, `PSX`) — so every one of them has a parent there. The entity carries the parent's
id, name and ISO alpha-2, its kind in the source's words (State, Province, County), and its
identifiers: `adm1_code`, `ne_id`, ISO 3166-2, HASC and Wikidata. It takes its *region*
from its country, which is what makes Europe, Asia and the other presets work on this map
without a second definition of any of them; a preset's transcontinental extras (Türkiye on
a map of Europe) bring their subdivisions with them.

**National borders are their own layer.** Every line between two subdivisions is a border
and the outlines draw them all at one weight, so a second network — the arcs whose two
sides have different parents — is drawn over them at twice the width. Both answer to the
Borders switch and neither to Coastlines, and the coast drawn on its own with Borders off
is each subdivision's coast, exactly as on the country map. Flags mode's international
treatment runs along the national network, not along every provincial line.

**Flags** work as they do on the states map: the flag library is keyed on ISO 3166-1 country
codes and has no artwork for a subdivision, so none is invented. Any subdivision can be
assigned a flag, and a merged body can fly one.

**Scale is what had to change.** 4,596 names are eighteen times the country map's, and the
name layout tested each candidate against every name placed so far, and its repair rebuilt
that list for every pair of neighbours it tried: turning names on froze the page. Collisions
now go through a grid of the placed names, answering in placement order so every test gives
exactly the answer the full scan gave, and the repair asks at most a name's six largest
neighbours within a map-wide budget. The world map's complete layout — all 254 names, under
two projections — is identical before and after, and its names now appear 6× faster.

Edits no longer cost a layout either. The names, the hidden set and the measured label
shapes are held steady across edits that do not change them, so typing a value with names
on is a repaint (about 40 ms here, where it had been seven seconds), and hiding a
subdivision filters the measured shapes instead of measuring the other 4,594 again.

**Opening it without holding the page.** Opening the map used to be one uninterrupted block
of several seconds — up to seventeen in the editor's test browser — in which nothing could be
clicked. Three things changed, none of them in what is drawn:

- *Measured once.* The metrics measured every polygon's area three times over; they now
  measure it once and sum the total through d3's own exact accumulator (`geo/adder.ts`), so
  every area is the number `geoArea` returned before, bit for bit. The tint colouring finds
  neighbours by a west-to-east sweep rather than testing ten million pairs, and the camera's
  framing reads those areas instead of measuring them again and no longer copies out every
  vertex to keep 6,000 of them. Metrics, border networks and all twenty region framings were
  checked identical before and after on every dataset.
- *Done in slices.* Decoding, repairing and measuring run a few milliseconds at a time
  (`geo/slices.ts`), handing the thread back in between — the same work in the same order.
- *Projected off the render path.* A dataset marked `progressive` has its outlines projected
  in slices after the render asks for them (`render/projectedLand.ts`), together with the
  magnifier anchors and click catchments; the map keeps showing the view it has until the new
  one is complete, and everything drawn over the land takes its projection from the land on
  screen, so nothing runs ahead of it. The lakes, rivers, border networks, coasts and names
  follow one render later (`useDeferredValue`), so the land paints first. The last three
  views are remembered on every map, so going back to a region, a projection or a map just
  left is instant, and merging no longer reprojects the whole map.

Measured on the production build, the old and new builds alternately in the same tab:
opening the map went from one 17 s freeze to drawn in 2.0 s with no block over 150 ms; a
region change from a 3.7 s freeze to 1.1 s with no block over 133 ms; returning to a view
already drawn from a 2.9 s freeze to 25 ms. Under phone emulation the old build froze for
9.3 s; the new one takes about as long in total but never blocks for more than about two
seconds. The world and states maps render byte-for-byte what they did.

Selecting many subdivisions at once is the Selection panel's job — see
[Selecting many territories at once](#selecting-many-territories-at-once), which works on this
map as on every other.


#### Official USA Administrative Map

A fourth atlas, separate from USA States (whose fifty states are still Natural Earth's): the
United States from official U.S. government data, for analysis and data visualisation.

**Sources**, all public domain as works of the U.S. Government (17 U.S.C. §105), credited in
Settings → Data sources:

- U.S. Census Bureau cartographic boundary files, 2024, 1:500,000 — `cb_2024_us_state_500k`,
  `cb_2024_us_county_500k`, `cb_2024_us_cousub_500k` — the Census Bureau's own generalisation
  of TIGER/Line for display, clipped to the shoreline.
- USGS Small-scale Dataset, 1:1,000,000-scale hydrography — waterbodies and streams — for the
  lakes and rivers. The Census files are clipped at the ocean, the bays and the Great Lakes but
  keep inland water as county land (Great Salt Lake, Okeechobee, Pontchartrain), so lakes of 3
  square miles and more, and rivers of Strahler order 6 and up, are drawn over the land the
  way every map here draws water.

**Three levels**, chosen under Map → Detail and projection → Detail, each its own file loaded
only when chosen:

| Level | Units | What |
|---|---|---|
| States | 56 | 50 states, the District of Columbia, Puerto Rico, Guam, the Northern Mariana Islands, American Samoa, the U.S. Virgin Islands |
| Counties (default) | 3,235 | counties and county-equivalents: 64 parishes, 40 independent cities, Alaska's boroughs and 11 census areas, 78 municipios, Connecticut's 9 planning regions, DC |
| More Detailed | 32,159 | county subdivisions that are legal units — towns, townships, boroughs, villages, barrios — and the county itself wherever a state's subdivisions are only statistical |

Statistical areas are never drawn as if they were administrative: census county divisions,
unorganized territory and census subareas are joined back into their county (from the
subdivision file's own lines, so it meets its neighbours exactly), and a county-equivalent that
is statistical says so in its type (Alaska's census areas).

**Every unit** carries its Census GEOID as its id (`county-06037`, the same at every level it
appears in), its official name and type from the Census LSAD code, and its state as its
parent — so state lines are the heavier border network — with the Census region and division
as selectable groups. Its codes (GEOID, FIPS, LSAD), land and water area and source file are
kept in a separate file, split by state at the subdivision level, and fetched when the
inspector shows the unit.

**Insets**: Alaska and Hawaii where USA States puts them; Guam with the Northern Mariana
Islands and American Samoa beside Hawaii; Puerto Rico with the U.S. Virgin Islands east of
Florida. Named by state, so each inset holds that state's units at whichever level is loaded,
drawn from their real coordinates.

**Checked on every build** (`data/usa-official/report.json`): ids unique; every county's state
present; the counts of California (58), Texas (254), Alaska (30), Louisiana (64), Virginia
(133), Maryland, Delaware, Hawaii (5), Puerto Rico (78) and DC; each state's counties and
subdivisions add up to its area within 1%; and any edge no neighbour shares inside the land is
reported, separated into shores of inland water and gaps.

Rebuilding: `npm run build-usa` (downloads the Census and USGS files into `.cache/` once).

#### Europe Countries and Europe Administrative

Two atlases under a **Europe** group in the Maps list, separate from the World and Modern
Administrative World maps (which stay Natural Earth's and unchanged). Built from official
national data rather than cropped from the world datasets.

**Source: EuroGlobalMap 2026** (EuroGeographics, 1:1,000,000, 47 countries and 13
territories). The national mapping and cadastral agencies' own data, harmonised across
borders by EuroGeographics. Its administrative areas carry EuroBoundaryMap's hierarchy (the
`SHN0`…`SHN4` codes with names and designations in `EBM_NAM` / `EBM_ISN`), which is what
lets each country be drawn at its own level.

- **Licence:** the EuroGeographics Open Data Licence, which permits commercial use with
  attribution. Attribution: "© EuroGeographics", plus the owning agencies listed at
  https://www.mapsforeurope.org/attributions. The credit is in Settings → Data sources.
- **Why not EuroBoundaryMap itself:** it was checked on 2026-09-19. EuroBoundaryMap (1:100k)
  is a paid product licensed by coverage, number of users and rights, and not open data.
  EuroGlobalMap carries its hierarchy and codes under the open licence. The unit ids below are
  EuroBoundaryMap's own numbers, so licensed EuroBoundaryMap geometry could replace the
  1:1M geometry later without changing an id.
- **Supplement: Natural Earth (public domain):**
  - the countries around Europe;
  - Russia east of 51°E, where EuroGlobalMap stops;
  - admin-1 units for the countries EuroGlobalMap describes only as a whole: Russia, Belarus,
    Türkiye, Georgia, Armenia, Azerbaijan, Montenegro, and Ireland's counties.

  geoBoundaries' layers for Russia, Türkiye, Azerbaijan, Montenegro and Luxembourg are
  OpenStreetMap-derived under ODbL or CC BY-SA. Those are share-alike, so they are not used
  for geometry.
- **Where the file goes:** request the GeoPackage at https://www.mapsforeurope.org (email and
  licence acceptance). Extract it into `.cache/egm/`, or leave the `euro-global-map-GPKG`
  folder in the project root, which is git-ignored. It is about 1 GB and never committed.
  Rebuild with `npm run build-europe`, which writes `data/europe/`.

**Europe is** every country and territory EuroGlobalMap covers there:

- Kosovo is its own country, from EuroGlobalMap's `optionKS` layer, as on the World map.
- Northern Ireland is part of the United Kingdom.
- Svalbard, the Faroes, Greenland, the Channel Islands and the Isle of Man are their own
  entities.
- The French overseas regions and collectivities, and Sint Maarten, are not in Europe and are
  left out.
- The land around Europe (North Africa, the Middle East, the Caucasus's southern neighbours,
  Kazakhstan, and Russia beyond 51°E) is on the map as context, outside the Europe region.
- Areas EuroGlobalMap marks as in dispute between two countries are entities of their own,
  held by neither: Croatia–Slovenia, Croatia–Serbia (the Danube islands), North
  Macedonia–Serbia. A disputed area that is water (the Ems–Dollart estuary) stays water.

**Borders are made to meet exactly.** EuroGlobalMap stores each area as its own polygon, and
neighbours draw their common border independently. Over Europe, 12,400 border segments are
held by one side only, the two copies typically 1–100 m apart. So the build
(`scripts/europe/atoms.mjs`, `resolve.mjs`) reconciles them before anything else:

1. Areas are placed in a fixed order, and each keeps only the ground no earlier area holds.
   1,602 areas lost a sliver, 9.5 km² in all.
2. The borders are noded, so both sides hold the same points.
3. The strips nobody covers (the holes of the land's union, found by merging the noded areas
   as one topology) join the area sharing most of their edge: 8,289 strips, 43 km² in all.
   Lakes stay water.
4. Every join (a country from its areas, a Land from its Kreise) is a Clipper union of
   unpinched rings. A TopoJSON merge drew chords across the land wherever a ring touched
   itself.

The build reports every border edge that no neighbour shares inside the land
(`data/europe/report.json`).

**Europe Countries: three levels of geometric detail** (Map → Detail), each simplified arc by
arc so borders stay shared (`simplify.mjs`):

| Level | Generalisation | Points | File |
|---|---|---|---|
| Full Detail (1:1M), the default | none | 1,804,441 | 16.71 MB |
| Standard | about 120 m | 504,188 | 5.63 MB |
| Light | about 600 m | 202,965 | 2.65 MB |

95 entities: EuroGlobalMap's countries and territories, 4 disputed areas and 34 neighbouring countries.

**Europe Administrative: three presets** (Map → Detail). Each country is drawn at the level it
is actually administered by, never one universal level. The table is `scripts/europe/levels.mjs`:

| Preset | Units | Points | File |
|---|---|---|---|
| Regions | 1,170 | 962,799 | 10.18 MB |
| Standard (default) | 2,659 | 1,187,519 | 12.57 MB |
| Detailed | 3,022 | 1,204,816 | 12.79 MB |

Unit counts include the 4 disputed areas and the 34 neighbouring countries, which are whole on every preset. Every preset is generalised to about 60 m, arc by arc.

Standard, for example: France 96, Germany 400, Spain 52, Italy 107, Poland 380, Romania 42, Bulgaria 28, Greece 52, the United Kingdom 186 (Northern Ireland's 11 districts included), Türkiye 81, Russia 84, Ireland 34, Ukraine 27, Serbia 25, Kosovo 38. Detailed adds Belgium's 43 arrondissements, Bosnia and Herzegovina's 143 municipalities and Slovenia's 212.

Examples of the Standard level:

- **France:** départements.
- **Germany:** Landkreise and kreisfreie Städte.
- **Spain:** provinces, with Ceuta and Melilla.
- **Italy:** provinces and metropolitan cities.
- **Poland:** powiats.
- **Romania:** județe and Bucharest.
- **Bulgaria:** oblasti.
- **Greece:** regional units, as Eurostat's NUTS 3, since EuroBoundaryMap's Greek hierarchy
  stops at the 13 regions.
- **Slovenia:** its 12 statistical regions, as NUTS 3. The 212 municipalities are the
  Detailed level.
- **Ukraine:** oblasts. EuroGlobalMap's raions predate the 2020 reform.
- **Luxembourg:** whole. Its only open subdivision layer is the three districts abolished in
  2015.

Where an area has no unit at a country's level (Vienna has no Bezirk, Ceuta no province), it
is drawn with the nearest level it has. Lakes that the national data keeps outside every
municipality (Ohrid, Prespa, Bodensee, Peipus) are water, not units.

**Ids:**

| Entity | Id format | Example |
|---|---|---|
| Country | ISO 3166-1 alpha-3, the World map's own | `FRA` |
| Disputed area | `eu-dispute-HR-SI` | |
| EuroBoundaryMap unit | `eu-ebm-<SHN>` (stable across releases) | |
| NUTS 3 region | `eu-nuts-<code>` | |
| Natural Earth unit | `eu-ne-<adm1_code>` | |

Every unit names its country as its parent. Its designation (`kind`) is EuroBoundaryMap's,
and the coarser units of its own country that hold it (its Land, its Regierungsbezirk) are
selectable groups. Lakes are EuroGlobalMap's own, 3 km² and up (4,813). Rivers are the World
map's Natural Earth rivers.

**What remains unshared.** The build reports every border edge that no neighbour shares inside the land. On Europe Countries at full detail it is 308.23 km in 95 pieces, and none of it is a gap between two countries:

- sub-10 m disagreements EuroGlobalMap's two copies of a border leave, a few kilometres per country (the largest a single vertex 3 m off the Swiss–German line);
- rings inside one country, with that country on both sides: Icelandic lake shores, Russia's New Siberian Islands, Egypt's Halaib line in Natural Earth's context data.

Generalising adds crossings where a thin spit's two shores run a few hundred metres apart, almost all on Russia's Arctic coast. The Russian figure rises from 72 km at Full to 475 km at Standard and 905 km at Light, always inside one unit.

**Tested** in the editor (`.cache/check-europe*.js`) on desktop and mobile:

- **All six datasets:** load and draw every entity; ids are unique; every entity has its table entry; every unit names its country.
- **The Maps list:** shows the Europe group; Map Detail lists the presets; region presets frame the Balkans, Iberia, the Baltic States, the British Isles and the Nordic countries.
- **Clicks select the right entity:** Ostalbkreis, Cantal, Piotrkowski, Cluj; Poland, France, Romania, Slovenia.
- **The other features work:** Data mode, Compare groups, labels, Flags mode, Hide Territories (hidden and restored), overlays, Water Regions, PNG, JPG and SVG export, and the blank SVG.
- **The hard places resolve correctly:** Llívia (Spain, in Girona), Büsingen, Campione d'Italia, the Vatican, San Marino, Monaco, Liechtenstein, Kaliningrad, Treviño (Burgos, inside Álava) and Berlin.
- **The existing maps are unchanged:** switching back to the World and USA maps leaves their geometry byte for byte as it was.

The data files are committed like the Official USA map's: about 68 MB in `data/europe/`.


### How region framing works

The camera is fitted to real polygons, not to a lat/lon rectangle, so it adapts to
whichever dataset is loaded. Two mechanisms keep that from going wrong:

- **`excludedAreas`** — named geography that is not part of the region at all, even
  though its country is a member. Membership is otherwise per country, which cannot
  say "Norway is in Europe but Svalbard is not": Natural Earth carries Svalbard
  inside Norway's own geometry with no separate ISO code. These areas are removed
  before anything else runs, so they never reach the framing pipeline. Europe
  excludes Svalbard/Bjørnøya, Jan Mayen, Bouvet Island, the Azores, Madeira and the
  Canaries. Sovereign island countries (Iceland, the Faroes) are *not* excluded —
  they stay part of Europe and are simply outside the continental camera window.
- **`domain`** — a declarative cartographic scope per region ("European Russia ends
  near the 50th meridian", "the world view crops Antarctica"). Geometry outside the
  domain still renders; it is just not considered by the camera.
- **outlier rejection** — the region's major landmasses form a core, and a minor
  polygon is framed only if it sits within `maxDetachmentDegrees` of something
  already accepted. Island chains connect one hop at a time, so Indonesia and the
  Pacific groups survive, while remote specks drop out of the camera without being
  hidden from the map.

- **`fill`** — how the letterbox is closed. A plain `fitExtent` *contains* the
  region, which leaves slack on whichever axis is not binding, and that slack is
  where the neighbouring continent shows up. `fill.amount` says how much of it to
  reclaim by scaling in.

  Closing a letterbox means something leaves the frame, so the question is what the
  region can afford to lose — and the answer is read off the geometry rather than
  declared. Every fit point carries the area of the polygon it came from
  (`fitWeights`), so the projected cloud can be asked for its **core**: the interval
  holding all but `CROPPABLE_AREA_TAIL` of the region's area at each end of each
  axis. What lies outside is fringe — the outer scatter of an archipelago, a
  peninsula's last kilometres, the tail of a steppe — and the camera may spend it.

  Two things bound that. Each framed landmass also contributes an anchor point
  (`fitAnchors`) the camera must keep on screen, because an area budget alone would
  sell Guam, Palau, the Marshalls and the Marianas to gain a few percent of zoom on
  Australia — half of Oceania leaving the frame while the budget still reads as
  untouched. And a region may declare a `fill.keep` box where its composition is a
  cartographic judgement its outline does not express; that composes with the core
  rather than replacing it, which is what makes a box written against one projection
  safe under the other eight.

  The core is computed on **projected** coordinates, which is what makes the whole
  mechanism projection-aware for nothing: Nell–Hammer squeezes Europe's latitudes
  into two thirds of the height Robinson gives them, so the two have different cores
  over identical geography and each gets the scale its own projected shape allows.

  It is also self-limiting, which is why no region needs a special case. Every edge
  of **Africa**'s frame is mainland coast — Tunisia at the top, Cape Agulhas at the
  bottom, Senegal and Somalia at the sides — so there is almost no area out in its
  tails, its core is nearly its full extent, and it barely moves. Africa stays whole
  because Africa's geometry says so, not because a rule names it. Measured across
  every region and projection the change buys 12–19% more of the viewport with
  essentially nothing cropped (≤0.2% of area, zero landmasses lost), and the world
  view is untouched because it sets `fill.amount` to 0.

  Which makes the projection, not the fill, the thing that decides how much canvas
  Africa gets — and a whole-world compromise is the wrong instrument for one
  continent. Equal Earth compresses meridians and stretches parallels near the
  equator, drawing Africa 0.727 wide per unit tall against a true figure near 0.94;
  the azimuthal equal-area the region now names, centred on the continent, shows it
  at 0.937. Same geography, same uniform scale, still equal-area, a third larger on
  screen, and the Atlantic and Indian Ocean margins fall from a fifth of the canvas
  to a ninth. Africa straddles the equator, so the equatorial aspect the camera
  rotates to is the natural one.

  A `keep` box states that the composition is the geography inside it and the rest
  is surplus, so the cap is measured against the kept geometry and the frame may be
  cropped outside it. **Europe** projects wider than it is tall, which hangs its
  slack over the North Cape and under Crete — Arctic Ocean, the Libyan Sea, and the
  gap Bear Island kept reappearing in. Its keep box runs east to 45°E, making the
  Caspian shore the currency the camera spends to close that gap; the composition
  then reaches from Iceland and the North Cape down to Crete, Malta and Cyprus with
  a 2% margin, at every viewport shape and dataset. Cropping comes off whichever
  side carries the surplus and only as far as the overflow demands, so Portugal and
  Ireland keep their margin while the steppe gives way. Compositions get no keep
  box: one region's surplus is the next one's subject, so Europe + Asia keeps
  everything it frames.

Only real vertices go into the fit. Feeding it the corners of the bounding box
instead puts points where no land is: on a conic the meridian fan is widest at the
low-latitude corners, so those phantom points stretch the horizontal fit and leave
vertical slack above the map — which is exactly where Svalbard reappeared on a map
of Europe.

Separation is measured on both axes against individual polygons, never against a
union bounding box — otherwise Iceland reads as a neighbour of Ireland simply
because Norway had already stretched the box's latitude range over it.

Nothing here is a hardcoded camera position: change the dataset and the bounds are
recomputed from that dataset's geometry. `__mapEditor.framing()` prints what the
camera resolved to.

#### Subregions

Each continent on the world maps has subregions under it: 22 in Europe, 20 in Asia, 14 in
Africa, 20 in North America, 13 in South America and 9 in Oceania. The Region list shows World
and the continents first. A **Subregions** button beside each continent opens its list
underneath, and only one continent is open at a time. A closed continent shows how many of its
subregions are on ("2 on"). Subregions combine like continents do, so Balkans + Baltic States
frames both. They are framing presets only. Choosing one moves the camera and marks what is
inside. It creates no dataset, group or merge, and never touches the geometry.

The definitions are in `geo/subregions.ts`, one line each, and each chip shows its definition
as a tooltip. They follow one rule per kind of region:

- **Compass-point regions** (Western Europe, East Africa, Central America, Micronesia…) are the
  UN M49 subregions, with the exceptions stated in each definition. For example, Saint Helena
  is left out of West Africa and the Chagos out of East Africa.
- **Physical regions** are the countries on them. When a feature covers only part of those
  countries, a `domain` box gives the feature's own extent: the Alps (the Alpine Convention's
  perimeter), the Carpathians, the Amazon basin, the Gran Chaco, the Sahel belt (11–20°N) and
  the Coral Sea.
- **Parts of countries** (New England, Siberia, Patagonia, the IBGE macro-regions of Brazil,
  Anatolia) are listed by ISO 3166-2 code, following whoever defines them: the US Census
  Bureau, the IBGE, Russia's federal districts and economic regions. The world maps draw
  whole countries, so a part cannot be drawn on its own. Instead the member's
  `memberDomains` entry holds the camera to the listed units' real extent, which
  `scripts/build-subregion-parts.mjs` measures from Natural Earth's 1:10m admin-1 boundaries
  into `geo/subregionParts.json`. The country is still drawn whole and counts as inside the
  region, so on a map of New England the rest of the United States is not dimmed.

Overlaps are deliberate. Scandinavia is inside the Nordic countries, and Indochina is inside
Mainland Southeast Asia. Each preset is a framing, not a partition.

Framing uses the same pipeline as the continents, with the continent's trim, margin and
excluded areas (a subregion of Europe drops Svalbard and the Azores too). Subregions add two
things, and neither changes a continent's frame. Both are gated by `explicitMembers`, and a
check against the committed framing code found the World, every continent and the
compositions identical on 10m, 50m, 110m and the administrative world:

- **Every named member is framed.** Its largest landmass anchors the core however small it is,
  so Cyprus stays in the European Mediterranean and Cape Verde stays in West Africa.
- **A member cut by the domain is clipped to it** (Sutherland–Hodgman). Otherwise only the
  polygon's own vertices would count, and inland there are none: the American Southwest was
  framed only up to 34°N, the latitude of the Mexican border's northernmost point, instead of
  reaching 42°N.

Albers' standard parallels come from the framed extent, one sixth in from each edge. Under
Auto (Equal Earth) the projection turns to the region's longitude, as it does for continents.

Checked by `.cache/check-subregions.js` for all 98 presets on 10m, 50m, 110m and the
administrative world, under all nine projections, at a desktop canvas and a phone canvas:

- every preset frames real geometry;
- at least 97% of its framed points and landmark anchors are on the canvas (on Mercator, not
  counting what lies beyond its 80° clamp);
- it fills at least 80% of the canvas on its binding axis;
- the geometry hash is unchanged afterwards.

The only differences between detail levels are islands the coarser data leaves out (Shetland,
the Ryukyus, the Chathams at 110m).

**Adding a subregion** is adding an entry to its continent's list. If it names ISO 3166-2 codes
from a country not yet in the build script's `COUNTRIES`, add the country there and rerun:

```bash
node scripts/build-subregion-parts.mjs
```

### Hide Territories

Hiding a territory removes it from the map completely, not just its land. Nothing drawn for it, or inside it, stays visible:

- **Drawn per territory, so each layer skips hidden ones:** land, coastline, its share of the border network, flag, island water, labels (names, data values, group values), magnifier, click targets.
- **Overlays:** an overlay copied from a hidden territory is hidden with it. A merged group's overlay is hidden once every member is hidden. The overlay itself is kept in the list and returns when the territory is shown again.
- **Lakes and rivers:** each is one path for the whole map, so they are clipped (`render/hiddenMask.ts`). The clip is the plane with the hidden territories' footprints cut out, using the same projection as the two layers. A shared lake loses exactly its hidden side, down to the border: hiding Uganda removes its part of Lake Victoria and leaves Kenya's and Tanzania's. A lake cut out of a territory as a hole (the Census Bureau's boundaries do this, and Natural Earth does for a few) is still inside that territory, so holes containing a lake are filled. Any other hole belongs to someone else's land and stays visible: hiding South Africa leaves Lesotho's rivers alone.

Nothing is deleted and the geometry is untouched. Showing the territory brings everything back, and exports carry the clip because they copy the live SVG.

Tested by `.cache/check-hide.js` on the world maps (10m, 50m, 110m), the administrative world, USA States, and the Official USA map (states and counties):

- lakes: every one inside a hidden territory is hidden, every one outside stays;
- rivers: tens of thousands of sampled points agree. The few that disagree lie exactly on the hidden territory's edge (0 px away), where a river forms the border;
- hidden land, labels and overlays are gone, neighbours are untouched, and everything returns on unhide.

### The geographic foundation

Every map draws from one curated foundation, prepared by `scripts/build-geography.mjs`
(`npm run build-geography`, a maintenance script: it reads Natural Earth from `.cache/ne/`,
downloading what is missing, and writes `data/natural-earth/`, which is committed — ordinary
builds only copy it). A new map built on these files inherits all of it; one built on raw
Natural Earth again would not, which is the reason the script is the only way in.

It exists because an audit of the land and water the maps drew found the gaps were in the
data pipeline, not the renderer — and not, mostly, in Natural Earth:

- **2,771 minor islands were on no map** — 15,357 km², 678 of them in Europe and 580 in
  Southeast Asia. Natural Earth keeps them in `minor_islands`, a layer of their own, and no
  map read it. Each is now given to its owner — the World-map entity whose maritime zone it
  lies in (Marine Regions), its own territory where the claimant's dependency is right
  beside it (Hong Kong's islets in China's zone), the coast it sits on when within 1 km, or
  the nearest land when no zone claims it — and joins that entity's geometry, and the
  nearest subdivision of it on the administrative and USA maps. All 2,769 that are not
  already land found an owner; the four where zone and nearest coast disagree, all at
  maritime borders, are listed in the report.
- **Most inland water was cut away.** 1,018 of Natural Earth's 1,355 lakes fell below a
  prominence cut, and none of its 1,929 supplementary European and North American lakes was
  read — the Dniester liman, Yalpuh and Kuhurlui in the Danube delta, the Molochnyi liman,
  the Étangs de Thau and de Vaccarès, the Lac de Grand-Lieu, Lake Alajuela on the Panama
  Canal, Laguna de Bay. All are now in the one water layer every map draws, with a
  supplement's lake dropped where the main layer already has it.
- **The grid was coarser than the source.** The 10m topologies were quantised to about
  400 m; a sand spit between a liman and the sea, or a lagoon's opening, narrower than that
  merged or closed, and specks of islands collapsed (Vatican City among them). The 10m
  topologies are now quantised to about 40 m, below the source's own vertex spacing.
- **Three maps, three pipelines.** The World map came from an older edition of Natural
  Earth via `world-atlas`, the administrative and USA maps from the current one, each
  prepared separately. All three now come from the current edition through the same steps,
  and the USA map is cut from the curated administrative set rather than from raw data.
- **Rivers** are every 10m river and branch, the whole Europe supplement and the North
  America supplement's major rank (its lower ranks are creeks at this scale).

The named oceans and seas are prepared the same way and kept beside it, by
`scripts/build-waters.mjs` (`npm run build-waters`) into `data/natural-earth/waters.geojson`
— a separate script because it reads a different Natural Earth layer (the 1:50m marine
geography) and answers a different question: not what the land is, but where one sea ends and
the next begins. See *Water Regions*.

Many famous lagoons and estuaries were never the problem: Razim and Sinoe, Sasyk, the
Dnieper–Bug estuary, the Oosterschelde, the Wadden Sea, the Venice and Curonian lagoons,
the Nile delta lakes, Chesapeake Bay and Lake Maracaibo are open water in Natural Earth's
coastline and were drawn as water throughout.

What Natural Earth does not draw at all, this cannot add without a finer source, and it
does not guess: the Westerschelde, the Haringvliet and Hollands Diep, the Khadzhibey,
Kuyalnyk and Tylihul limans, Lake Kahul and Songkhla lake are land in every Natural Earth
layer. `data/natural-earth/geography-report.json` records every assignment, every source
count and where each of the audit's named places stands, so those gaps are known rather
than papered over. Closing them means adding a finer public source — HydroLAKES or GSHHG
for inland and coastal water — as another input to the same script.

### What a phone opens at

**The automatic Map Detail is 50m, on a small touch device only.** Opening the World map on
a desktop still loads 10m, as it always has; on a phone it loads 50m, and the difference is
the whole point of the setting: 644 KB against 6,017 KB of geography on first load, measured
over the wire (`countries-50m.json` at 227 KB against `countries-10m.json` at 1,565 KB, and
the lakes layer follows the dataset's own detail — 405 KB against 4,440 KB).

**The middle resolution, not the lightest.** 110m is a different map rather than a coarser
one: it names 177 of the 254 entities this app knows, and the rest only reach it through the
low-detail supplement (see above). 50m carries 240 of them at a fraction of 10m's weight,
which is the trade a phone wants by default — most of the geography, little of the cost.

`maps/startingDetail.ts` decides it, and what it is not matters as much as what it is:

- **Not a cap.** 110m, 50m and 10m are all in the picker on a phone exactly as before, and
  choosing one loads it.
- **Not sticky against the author.** The moment they choose a detail themselves, the
  automatic choice steps aside for the rest of the session, so opening another map does not
  hand them 50m again. Verified: a manual 10m survives a region preset, a projection change,
  a resize, an orientation change, opening and closing panels, and switching to another atlas
  and back.
- **Not re-decided later.** The device is read once, so nothing that happens afterwards —
  rotating, resizing, switching maps — reconsiders it.
- **Not a change to any other map.** Only the World map has more than one resolution; the
  administrative, USA and Europe atlases have one geography each, so they open exactly where
  they did.

"Small touch device" is a coarse pointer *and* a screen whose shorter side is 820 px or less,
so it reads the same in portrait and landscape and a touchscreen laptop is not caught. A phone
and a small tablet qualify; a 1024-wide tablet and every desktop do not.

The two maps are not quite the same map: 110m omits Bir Tawil and the Southern Patagonian Ice
Field, which are unclaimed ground rather than countries. Every country, microstates included,
is on the 110m map — see the next section for how.

### Entities a coarse dataset omits

Natural Earth's three resolutions are not the same map at three levels of detail —
they are three editorial selections. Counting the entities each one names against the
254 this app knows:

| | entities named | usable | absent |
|---|---|---|---|
| 110m | 177 | 177 | **77** |
| 50m | 240 | 240 | 14 |
| 10m | 254 | 253 (Vatican City collapses) | 0 |

Nothing was wrong with the loader: the 110m file has no Monaco in it. The audit that
established this compares ids, not names or sizes, and it runs over the whole world
rather than a list of usual suspects — which is how the count came out at 77 across
every inhabited region, not at the six European microstates you would guess.

`scripts/build-lowdetail-geometry.mjs` closes the gap. For each entity a layer omits
it takes the shape from the **finest** layer that does describe it and simplifies
every ring down to the vertex budget the 110m layer spends on its own small
countries. Taking the coarsest layer instead looks thriftier and is a trap: the
coarse layers drop islands as well as vertices, so a Cook Islands lifted from 50m
arrives as one island out of thirteen and the Maldives as two atolls out of 175.
Vertex count is what simplification is for; island count is not recoverable once it
is gone, and the distributed assisted-selection system has nothing to work with
without it.

The budget is measured from the 110m layer rather than guessed: its entities under
20,000 km² carry a median of 4.9 points per degree of diagonal and never fewer than
six points per polygon — Luxembourg 6, Cyprus 14, Kosovo 20. A supplemented Malta
therefore sits beside a source-data Cyprus without looking traced from a finer map.
The budget is a target and not a rule: the hard constraint is that a ring still
encloses the ground it started with, within 12%, because the area a supplement
encloses is the area the app reports and what its small-entity and archipelago
classifications are drawn from. That guard is what keeps the Cyprus buffer zone — a
180 km ribbon a few kilometres wide — from losing three fifths of itself to a point
count that suits blobs.

The result is 76 generated entities, 619 polygons, 3,538 points, from 9,703 in the
source. Vatican City stays hand-maintained, since no layer at any resolution supplies its
real outline. Every coordinate is a real Natural Earth lon/lat carried over from a
source ring: simplification only removes points, and nothing is drawn, invented,
moved, scaled or merged. Polygon counts match the 10m dataset exactly — the Maldives
keep all 175 atolls at 110m, French Polynesia its 88 islands, Kiribati its 35.

Two consequences worth knowing. **Paint order is by descending area**, set in
`datasets.ts`: SVG has no z-index, so a country is covered by whatever is drawn after
it, and sorting by name left that to the alphabet — fine for Vatican City over Italy,
wrong for Andorra under France and Gibraltar under Spain. A shape that encloses
another is necessarily the larger of the two, so ordering by size puts every host
before everything it holds without naming a single pair. It only became visible once
the coarse layers stopped omitting those entities, because the finer ones cut a hole
in the host and the coarse ones do not. And **the 110m and 50m region framings moved**,
because Oceania at 110m now contains the Pacific instead of just Australia and New
Zealand. Both now agree with the 10m framing, which is unchanged.

### Small geographic entities

A country of a few square kilometres is a fraction of a pixel at continental zoom and
cannot be clicked. Two editor-only affordances make the map usable without forcing the
user to zoom, and they are deliberately independent of one another:

- **assisted selection** — an invisible catchment that follows a country's actual
  islands, so a speck or a scattered archipelago can be hit;
- **the magnifier** — an enlarged copy of a selected feature's own outline, so a
  selected speck is visible. Optional, and off until turned on: *Magnifying Glass* in
  Display → Labels & Helpers, one switch for every map, session state rather than document content.
  It used to have no switch at all, so selecting any small entity summoned a lens.

Nothing draws a small entity larger than it is — see *No minimum rendered size* below.
The magnifier is keyed to whole countries below `SMALL_ENTITY_AREA_KM2` (1,000 km², in
`geo/metrics.ts`). Assisted selection is not, because being small is not the same problem
as being scattered.

#### Assisted selection follows the islands, not a point

The unit is the island, not the country. `metrics.ts` reduces every polygon of every
feature to its own geographic bounds — longitudes unwrapped, so a ring crossing the
antimeridian reports the span of an island rather than of the globe — and
`buildAssistIndex` projects each one into a catchment. The Maldives get 175
catchments strung along their atolls; a country whose land is one landmass gets one.

Which countries may be claimed this way is decided from geometry alone, with no list
of names. A country qualifies when it is a small entity outright, or when it is
**archipelagic**: several separate polygons, and no single landmass that both
dominates its area and is large enough to click. Either the largest island is itself
under `ASSIST_ISLAND_AREA_KM2` (Comoros, Mauritius, Samoa), or the land is spread
thin enough that the largest island holds less than `ASSIST_DOMINANCE` of it. The
measured split is wide and empty — Solomon Islands 0.20, Marshall Islands 0.25,
Bahamas 0.28, French Polynesia 0.31, Maldives 0.32, Philippines 0.36, Kiribati 0.46,
Fiji 0.58, against Japan 0.61, Denmark 0.67, Norway 0.79, Greece 0.81, the UK 0.90 —
so a mainland country with islands keeps ordinary geometry selection everywhere. 83
of 254 countries qualify at 10m, 69 at 50m, 7 at 110m.

A catchment is its island's projected bounds grown by a padding, and the padding is
the difference between what the island already occupies on screen and
`ASSIST_TARGET_PX`. A sub-pixel speck is grown to a comfortable target; an island
already that big is grown by nothing and answers clicks on its own outline. So the
help fades out smoothly as the camera zooms in, and no catchment is ever fixed in
geographic units: assistance around a Maldivian atoll reaches 1,591 km at world zoom,
436 km at 4× and 92 km at 16×, all of them the same handful of pixels. Islands near
each other overlap and read as one region — which is what makes the water inside an
atoll and between two islands of a group selectable — while islands far apart stay
far apart. Kiribati resolves into five independent regions covering 23% of its
bounding box; the Cook Islands' northern and southern groups never join.

#### Nobody wins for being small

Catchments overlap each other and the countries around them on purpose, so the
contest is settled by geography rather than by who was given the larger radius. Two
facts are gathered in one pass over the index: which island is *nearest* to the
cursor, and which island actually *reaches* it. A claim stands only when the two
agree on the country. That single test is what stops a catchment swallowing its
neighbours — a speck padded out to 22 px beside a larger island padded by 4 px cannot
take the water in front of that island, because the larger island is nearer there and
does not reach, so the point resolves to nothing and the click falls through to the
real geometry underneath. Islands of the same country never compete with each other,
so a group still reads as one continuous region.

Reaching over another country's *land* is a separate privilege with its own,
shorter allowance, scaled by area between `ASSIST_OVER_LAND_MIN_PX` and
`ASSIST_OVER_LAND_MAX_PX` and never exceeding the padding. Monaco has to be selectable
from the French pixels around it because at continental zoom there are no Monegasque
pixels to click; the Isle of Man has no business answering for the middle of Ireland
sixteen pixels away. An archipelago that merely has small islands gets no allowance at
all — the Bahamas' nearest cay sits a dozen pixels off the Cuban coast, and a click
well inside Cuba means Cuba.

Islands belonging to countries that need no assistance are still carried in the index,
because a country that is not there cannot answer for its own land. They never claim,
and they count for only one thing: standing on one settles the question outright. That
is a statement about the pixel under the cursor, not about the neighbourhood — it
keeps Åland from answering for the Finnish skerry beneath the cursor without costing
Vatican City the Roman pixels it has nothing else to be clicked from. A mainland is
excluded from even that, both because its bounding box is a poor likeness of it and
because being somewhere in Italy is the exact situation Vatican City exists for.

Measured against the previous representative-point circles, over an interior point of
every polygon of every country at seven region framings: 1,552 of 4,252 island
interiors resolved to the wrong country at world zoom, now 65; 183 in Asia, now 5; 80
in North America, now 2; 24 in Oceania, now 0. No case that resolved correctly before
resolves incorrectly now.

#### The magnifier

What the lens fits depends on how spread out the country is, measured as its full
projected extent over its largest polygon's. Below `SMALL_ENTITY_MAX_LENS_SPREAD`
the parts hang together and the whole country is fitted; above it they do not, and
only the main landmass is. Bahrain scores 1.6, Malta 1.6, St Vincent 3.2 and Antigua
4.1; Seychelles 31, Marshall Islands 37, Maldives 87, Micronesia 100 and Kiribati
804. The gap between the two groups is wide and empty, so the threshold sits in the
middle of it at 6. Fitting all of Kiribati would need the lens to show 44,692 px of
ocean, which is what the rule exists to prevent.

Representative points, which anchor the lens, are the centroid of the feature's
**largest** polygon, because the centroid of a scattered archipelago lands in open
water. That centroid is then checked with `geoContains` and falls back to the nearest
point on the boundary — a ring-shaped atoll centres on its lagoon, which is exactly
the Maldives at 10m.

Everything here is an editor overlay. `metrics.ts` computes areas and island bounds
once per dataset load and `buildAssistIndex` projects them once per projection change;
pointer movement does one pass of arithmetic over the index (3,944 boxes at 10m,
14 µs) and no geographic maths at all. **No country polygon is ever enlarged or
modified** — the geometry that renders is the geometry that exports.

### Selecting many territories at once

**The Selection panel** is on every map, in the same place on the rail and with the same
controls: it selects countries and territories on the World map, states, provinces and
regions on the administrative world, states on the USA map — whatever the open map's entities
are, in its own words (`Atlas.noun`), and whatever a future atlas brings, with nothing to add
for it. Both tools add to the ordinary selection through `addToSelection`, so the inspector,
the palette, merge groups and everything else that reads a selection work on theirs. Both
deselect as well, the way a click does: a rectangle over entities that are mostly selected
already takes the selected ones out, and a brush stroke that starts on something selected
takes out whatever it passes over.

- *Rectangle selection* (on by default): hold the middle mouse button and drag. The box is
  anchored to the map, so zooming with the wheel mid-drag keeps its corner on the place it
  started; releasing selects every territory whose drawn outline meets it — an edge inside or
  across it, or the outline all around it. Drawn over territories that are at least half
  selected, it deselects the selected ones instead, and leaves a neighbour whose edge it only
  clips as it was. It never moves the camera. The browser's
  middle-button autoscroll is refused only while the tool is on, and Escape cancels.
- *Brush mode* (off by default): hold the left button, or a finger, and drag; every territory
  passed over is added as the stroke goes, once. A stroke that starts on a selected territory
  erases instead, taking out every selected territory it passes over. The stroke is tested segment by segment, so a
  fast one cannot step over a narrow territory, with a footprint of a pixel for a mouse and a
  fingertip for touch; it also asks the click resolver at the pointer, so the catchments that
  make a speck of an island clickable make it brushable. While it is on, a drag paints rather
  than pans — the wheel, the zoom buttons and a two-finger pinch still move the camera — and
  the click that follows a stroke is not taken as a toggle.

**One implementation, whatever the map.** The tests are made against the outlines as rendered,
which is why nothing about them depends on the dataset: the path strings every entity is drawn
from are read back into vertices once (`render/selectionGeometry.ts`, read ahead in slices when a
tool is on) and tested exactly. The differences between maps are differences in how outlines
are drawn, and the tests follow the drawing: every entity is tested at the size and place it is
drawn, and one drawn in an inset — Alaska and Hawaii — is tested only inside
the inset's frame, because the outline runs on past it (Hawaii's north-western atolls) and the
part beyond is clipped away. The tools are live on any map that has drawn something to test.

While a stroke or a box is being drawn the page is a canvas: the press's own default is
refused where it starts, so the browser begins no text selection under the stroke and shows no
selection menu, and text selection, context menus, touch callouts and image drags are refused
for exactly as long as the gesture lasts. The box and the brush ring are HTML over the map,
outside the `<svg>`, so no export can contain them. A rectangle is one undo step, and so is a
whole brush stroke.

On every map, a click or tap on water — anywhere that is not a territory — does nothing. It
used to clear the selection, and water is most of the map; the Clear buttons are the way to
start over.

### The shell

Two columns: a sidebar, and the map taking everything else. There was a second panel on
the right holding the inspector, the colouring modes and the legend; it is gone, and its
contents are sections of the sidebar. One place to look for a control instead of two,
and the 276px that panel held permanently — whether or not anything in it was being used
— now belongs to the map. Measured: 715px of map became 963px.

The **left sidebar is a rail plus one panel**. The rail is always visible and always
56px, so the map's left edge only moves when the author asks it to; choosing a section
slides a 232px panel out beside it, and choosing the same section again closes it. One
section at a time rather than a scrolling column of all of them — the previous layout
put region chips, three selects, five switches and three colour wells on screen at once
and left the reader to work out which belonged together.

The sections are a plain array in `Sidebar.tsx`: an icon and a body. Adding one is an
entry, not new markup or new styling, and it inherits the animation, the active state
and the keyboard behaviour with everything else.

**An open panel is glass over the map, not a wall across it.** Its head, its scrolling body
and the pad at its foot each take the theme's own panel colour at around 70% with a 10px
backdrop blur (`--panel-overlay`, set by each theme rather than one alpha imposed on all
three: the light themes need more of themselves to hold text over a busy map than the dark
one does). Those three tile the panel from top to bottom, so it is exactly as tall as it
always was — nothing is cut short to expose the map. What changed is that the map is plainly
visible through it: coastlines, borders and the colours being worked on. Nothing fancier than
that — no gradient, no reflection, no edge glow, each of which costs legibility and hides the
map. The controls keep their own opaque surfaces, so every input, button and card reads
exactly as it did, and the rail keeps its solid background, so the icons never sit over moving
geography. The blur is one radius over one strip of screen: a drag with a panel open measures
the same 4.2 ms frames as a drag with it closed, and removing the blur changes nothing
measurable.

**A phone's panel carries a small window onto the map at its foot.** An open panel there is
most of the screen, and what is left of the map is too narrow to drag — so above the panel's
bottom edge sits one rectangle, about a thumb tall (110px of a 730px panel; 70px turned
sideways), that pans and pinches the map underneath it (`MapGrip`, `mapCamera.ts`). It is a
pad *inside* the panel, not the end of the panel: the controls above it keep their full height
and scroll as they did, and the panel's glass continues past it to the bottom of the screen.

The window is a real hole in that glass. The pad's surface is painted in a layer of its own
and masked so the rectangle is cut out of it, which is why what shows there is the map itself,
sharp, rather than one more sheet of glass. Desktop has no pad: there is map on either side of
the panel already.

It is not a second navigation system. A gesture there is handed to the camera the map already
has — the same d3 zoom behaviour a drag on the exposed map drives — so the scale limits, the
pan bounds and the frame-by-frame placement are the ones that were already there. Measured on
a phone: the map follows the finger one pixel for one pixel, the camera reaches the document
**once** per drag rather than once per frame, dragging in the window scrolls the panel by
nothing, dragging in the controls moves the map by nothing, a tap selects no country, and the
frames cost what a drag on the map itself costs. `touch-action: none` is what keeps the
browser from scrolling the panel or swiping the page underneath the gesture.

**The rail is two levels deep**, ten sections in the order the work goes — which map, what is
selected, what is done to it, how it is drawn, what colours it, what is laid over it, how it is
explained, how it is framed — then the editor's own preferences and the assistant to come. Each
section's parts sit behind a `Disclosure`:

```
Maps            Map · Region · Map Detail · Outside Region Appearance
Select          [Normal / Rectangle / Brush] · How the tools work · Entities Selected
Edit            Merge Groups
Display         Appearance · Geographic Features · Labels & Helpers · Territories · Legend Visibility
Styles & Data   [Off / Data / Compare / Flags and each mode's workflow]
Overlays        Overlay Management · Overlay Appearance · Overlay Transform · Overlay Mode
Legend          Visibility · Content · Appearance · Layout · Position & Size
Canvas          Aspect Ratio · Dimensions · Framing
Settings        Appearance (theme) · Data Sources
AI              one line: coming soon
```

Every control is the component it was, with the same hooks and the same operation — moved, not
rebuilt. Where one component held controls for two sections it was split along that seam:
`MapSettings` now exports the map's own settings (`MapDetailSettings`,
`OutsideRegionAppearance`) for Maps and the layer switches (`GeographicFeatureToggles`,
`LabelsAndHelpers`, `HideTerritories`, `LegendVisibilityToggle`) for Display; the legend and
overlay editors wrap their existing blocks in subsections inside the same component, so their
local state — the overlay's pending flag choice, the legend's patch helper — did not have to
move. **Show Legend** appears in two places on purpose and is one control: Display and Legend write
the same `legend.visible`. Undo and redo live in the header only — those arrows and the
shortcuts call the same `undoMapEdit`/`redoMapEdit`, and the shortcuts are registered once. A
second pair under Edit → History was removed with the Merge rework: it was the same store
history shown twice, beside a tool it had nothing particular to do with.

What changed besides position:

- **Outside Region Appearance** is the old "Outside the region" select, and **Normal (match
  region style)** is its old "Same as in-region" — the same three `outsideScope` values, named
  for what the land looks like, with a line under it saying so.
- **Map Detail**'s dataset picker is labelled **Resolution** on the World map (10m, 50m, 110m)
  and keeps the atlas's own label — **Detail** — on a map whose datasets are levels.
- **Select** shows three tools. **Normal Selection** is on whenever neither Rectangle nor Brush
  is, and choosing it turns both off; a click selects and deselects exactly as before whichever
  is on. The three paragraphs of help fold under *How the tools work*. The count reads
  **Entities Selected: N** and includes water regions, because countries, subdivisions,
  territories, merged groups and seas are all selectable.
- **Merge** moved from under Data to **Edit → Merge Groups**. It stays folded when Edit opens:
  opening it is what makes a tap on the map build a group, so it is opened on purpose rather than
  by opening the section to undo something. Closing it leaves Merge Mode, as before.
- **High-Contrast Borders** is Flags mode's old "International Borders" — the same
  `flags.internationalBorders` and the same black line with a pale edge either side. Every border
  the plain switch draws is international too, so the old name said nothing about what changes.
- In **Legend**, the title's decorative mark is now **Title Mark**, so that "icons" means what
  the items are — each colour indicator and its text, sized by **Item Icons**. With the legend
  hidden, the editor stays usable and says the legend is hidden.
- **Settings** holds only the editor's preferences: theme and the data-source credits. Map Colours and Selection Highlight moved to Display →
  Appearance.
- **Canvas** is the old Screen. Its **Fit to Region** did nothing in a production build: it read
  the live projection from `window.__mapProjection`, which the canvas publishes only in
  development. The canvas now publishes it through `render/liveProjection.ts` in every build, and
  the button frames the region as drawn — wide for Europe, tall for Africa — without touching the
  camera, the projection or the geometry.
- On a landscape phone the ten rail items do not fit in 290px of height, so the rail scrolls, as
  it already did with nine. A shadow now appears at whichever end has more sections past it — pure
  CSS, and nothing at all on a window tall enough for the whole rail.

**Nothing is open by default.** A fresh editor has no section open, and opening a section opens
that section and nothing inside it: every subsection, and the Maps list's two groups, start closed,
on every device. Closing a section unmounts its body, so opening it again starts closed again — and
a template that opens a section when it is applied opens that section alone. Checked by opening
every section on a desktop window and on a phone, with an overlay chosen and a merge group present
so the subsections that only appear then were there too: nothing inside any of them was expanded,
on first opening or on reopening after everything had been expanded by hand.

**The Maps list is grouped by what a map is of.** Two groups sit at the top, **World** and
**USA**, and each is a disclosure that opens onto its maps:

- World holds **Modern World** and **Modern Administrative World**;
- USA holds **USA States** and **USA Administrative Map**.

Both groups start closed, like every collapsible in the sidebar; the map in use is marked in
its group and named in the accent on the group's header, so it shows while the group is closed.
The two groups open and close independently.

The group each map belongs to is data on the atlas: `family` in `atlas.ts`, the groups
themselves in `ATLAS_FAMILIES`. The list's own label is `menuName`, used where the group makes
a map's name read oddly — the World map is "Modern World" under "World". Nothing else about a
map changed: its id, its data and what switching to it keeps are exactly as they were.

Nothing about a control changed in the regrouping — every one is the same component with
the same props, referenced exactly once, in a different place in the tree.

A `Disclosure`'s open state is local component state and its children are **unmounted**
while closed, so a folded subsection is not reading the document on every render, and
expanding one touches nothing outside the panel: measured across opening all six sections
and expanding every subsection, the map container's box, the projection and the camera
transform were all identical to before.

The body is **keyed by section id**, which is load-bearing rather than tidy. Without a
key React reconciles the two trees by position: Settings' second `Disclosure` and Map's
second `Disclosure` are the same element type in the same slot, so React keeps the
instance — and its open state travelled between sections, where leaving Sound expanded
made World expand. The key says these are different things, which is the truth.

Two of the groupings were judgment calls. The colouring mode switch and everything it
governs stay in **one** section, because the switch decides what the rest of the section
even is — a palette, comparison groups, flag options — and separating them would leave a
control pointing at a section the reader has to go and find. Merge sits under them rather
than beside them: it is a separate act on the same selection, so folding it away keeps it
from competing with the mode the author is actually in. The **legend** went the other
way: it describes whatever is colouring the map, which is why it used to sit inside Data
as a disclosure, but it is the largest group of controls in the editor and a section of
its own is what a rail is for. Its panel-size block is folded into a disclosure there,
since the legend's own corner already resizes it by hand.

**The panel is an overlay, and that is a performance decision as much as a visual one.**
The grid column is a fixed 56px — the rail — and the panel is absolutely positioned out
of it, floating over a map that never moves. It used to be a grid item sized `auto`, so
opening a section narrowed the map's container by 260px; the canvas measures that
container, and its width feeds the projection. Every open re-fitted the projection and
rebuilt the country paths, the flag tiles, the maritime shapes and the boundary network,
to show a panel. That was the lag, and the map sliding sideways was the same bug.
Measured after: the map holds x=56, width 1224 and viewBox `0 0 1224 654` across all nine
sections.

It slides on `transform`, not `width`. A width animation is a layout animation — it
reflows the panel's contents every frame — where a transform is composited and touches
nothing underneath. Closed, it is translated left by its own width, parking it behind the
rail, which carries the higher stacking order.

`pointer-events` does the hit-testing, not `visibility`. The visibility flip is delayed by
a transition so the panel stays visible while it slides out, and a transition can be
paused, reduced, or never started — while it lingered, the parked panel sat over the left
260px of the map swallowing clicks, and `elementFromPoint` returned the panel instead of a
country. Interactivity must not depend on an animation having run. Verified: with the
sidebar closed, probes at x = 80, 120, 200 and 300 all reach the map, and a click selects
the country under them.

The section's contents unmount when it closes, but not until 260ms after — a panel with
nothing in it slides out empty.

`flex: none` on the panel is load-bearing, and was not obvious. The panel hides its
overflow, so its min-content width is zero, and a flex item that may shrink was duly
shrunk to nothing by the grid column measuring the sidebar: the class toggled, the width
said 232px, and the panel rendered two thirds of a pixel wide. Refusing to shrink is what
makes the declared width the real one.

The existing control components were **split, not rewritten**. `MapSettings` became
`MapScopeSettings`, `MapDisplayToggles` and `MapColorSwatches`; `SettingsPanel` became
`ThemePicker` and `SelectionHighlight`; `LegendControls` gave up its
panel-size block as `LegendSizeControls`. `Inspector` and `DataPalette` moved across
untouched. Same hooks, same operations — the only thing that changed is which heading
each control appears under.

### Controls

Every interactive thing in the interface — chip, select, tab, toggle, button, colour
well — is built from five variables at the top of `styles/global.css`: one radius, one
small radius, two row heights, one duration and one easing curve. The theme supplies
the colour; these supply the shape, size and timing. That is the whole reason a
region chip, a dataset dropdown and a display switch look related — not because each
was styled to match the others, but because none of them chooses its own geometry.

Three behaviours are shared rather than repeated. **Hover** raises the surface a step
and strengthens the border. **Pressed** compresses to 0.985 and applies
`brightness(0.96)`, which darkens graphite and paper alike, so one rule serves all
three themes without any of them naming a colour for it. **Focus** is a single
selector listing every focusable control, so a chip, a select and a colour well
announce focus identically; `:focus-visible` throughout, so a pointer click never
draws a ring only a keyboard user needs. All of it is switched off under
`prefers-reduced-motion`.

Native controls stay native. The selects are `<select>` elements with
`appearance: none` and a chevron drawn by the wrapper as a rotated corner — the popup,
type-ahead, keyboard behaviour and screen-reader semantics are the browser's. The
colour wells are `<input type="color">` stretched to fill a labelled container, with
the `<label>` wrapping the input so the caption opens the picker too. Region chips are
buttons carrying `aria-pressed`; display switches are buttons carrying
`role="switch"` and `aria-checked`; and because regions are additive, selection is
marked by a tick as well as by the accent fill — three ticked chips say "three regions
compose this map" in a way three accent fills alone leave you counting.

### Performance on dense maps

**The cost was the country layer, rebuilt whole on every render.** For every entity the canvas
built a paint and three elements, then compared them: 256 countries on the World map, 5,257 units
on the Detailed World Map at its finest level, and 32,159 on the USA map's subdivisions. The canvas
renders on every hover change, every selection toggle, every brush frame and every document edit,
so the cost grew with the number of entities. A pointer crossing one border on the USA map froze
the page for a quarter of a second. So did an overlay's opacity slider, which changes nothing any
country is painted from.

What changed, in `MapCanvas.tsx`:

- **Paints are kept, not rebuilt.** They are memoised on exactly what `paintCountry` reads, which
  is everything but the hover. The zoom counts only while flags are drawn, since it sets a flag's
  border width and nothing else.
- **A selection-only change repaints only what it touched.** A click, a brush frame or a rectangle
  repaints the entities whose selection flipped, and keeps every other paint.
- **Elements are reused.** Each entity keeps its element while its paint, path and coast are
  unchanged, so React passes over it by reference.
- **The layer is drawn in chunks** of 256 entities (`COUNTRY_CHUNK`), each a memoised component. A
  chunk holding exactly the elements it held last time is the same array, and React skips the whole
  of it. A hover or a selection change reaches one or two chunks, not the layer.
- **The hovered entity is the only element made afresh on a hover.** It is painted exactly as
  before and drawn in its own place, so what is drawn, and in what order, has not changed.

`MapOverlays.tsx` now works out where each overlay rests once per change to the overlays, not on
every frame of a drag. A projection-aware overlay has to be reprojected to be placed.

Measured in the dev build, from a store change to React's commit, as the median of 8 runs:

| | World (256) | Detailed World, maximum (5,257) | USA subdivisions (32,159) |
|---|---|---|---|
| Hover change | 4.7 → **1.2 ms** | 40 → **5.3 ms** | 247 → **2.9 ms** |
| Selection toggle | 3.0 → **1.4 ms** | 50 → **5.4 ms** | 238 → **21 ms** |
| Brush frame (10 added) | 3.1 → **1.3 ms** | 35 → **4.1 ms** | 227 → **22 ms** |
| Zoom commit | 2.9 → **0.7 ms** | 37 → **2.1 ms** | 223 → **1.8 ms** |
| Mouse move over the map | 9.5 → — | 43 → — | 248 → **12 ms** |
| Overlay slider | — | — | ≈223 → **5 ms** |

The timing uses `MessageChannel` ticks, which a hidden tab does not throttle, and each change was
checked against a control. Every change was also checked for what it draws, on all 32,159 units:

- hover and unhover;
- a unit hovered while selected;
- a 300-unit brush batch selected and cleared;
- the draw order;
- island water, still 72 bodies;
- Vatican City, still growing exactly 4× at 4× zoom;
- merges, labels, flags, and an overlay export without its editor handle.

**Checked and found sound:** hit-testing (outlines parsed once and indexed; a rectangle over 7,845
units spends 7 ms finding them), the projected-land cache (the last 3 views), undo history (100
steps), event listeners (every one removed, or registered
once for the page's life), and animation frames (requested only while a gesture runs).

**Across platforms:**

- **Long press.** On a phone, a long press on the map no longer starts a text selection on a
  name or opens a callout. `#map-canvas-svg` refuses both, where before only brush mode did.
- **Export on iPhone.** The export's object URL is revoked after a minute rather than on the next
  frame. Revoking it sooner could cancel the download in Safari, on iOS especially, and in Firefox.
- **Shortcut tooltips.** Undo and redo read ⌘Z and ⇧⌘Z on Apple keyboards. Both key sets were
  already handled everywhere; only the label was wrong.

**Selection is drawn in a layer of its own.** The work above made the *app* side of a click
free — one paint, one element, one chunk, one render, measured — and a click still cost 45 ms on
Europe Administrative. The remaining cost was not React's and no memo could reach it: selection
is a fill (`resolveCountryFill`), so clicking repainted that path inside the map's one layer, and
the browser then rasterised every path overlapping the damaged region again. Measured with the
DOM alone, outside the app: **45.7 ms to change one `fill` attribute** there, against 4.4 ms for
the same shape in a layer the compositor holds by itself.

So the land now keeps its own paint for good, and what "selected" looks like is a copy of the
entity's path — same geometry, same clip, same border ink the entity would have been painted
with — in a `map-selection` group above the land and below everything drawn over it, which is
where a selected fill always sat. Three details make it behave:

- **It is promoted only while something is selected.** A layer held over the map permanently
  changes how the map beneath it is rasterised by about 410 pixels of a 900,000-pixel frame; with
  nothing selected the map is again the map it always was, to the pixel.
- **A transparent rectangle gives it bounds that do not move.** A layer resizes with its contents
  and a resized layer is built again: without this, selecting entities of different sizes rebuilt
  it every time, at 99 ms a click.
- **It is held for 1.5 s after the last entity leaves it**, so tapping one entity on and off does
  not build and drop a layer per tap.
- **Coastlines-on-with-Borders-off keeps the old behaviour**, because there each entity's only
  line is its own coast, drawn beside it: a selected coast in the layer and an unselected one
  under it are two coincident strokes whose edges blend. That state paints selection into the
  land, exactly as before, and costs exactly what it did.

Frame intervals with a selection change every frame, before → after (median, p90):

| | World (256) | Europe Administrative (2,659) | USA counties (3,235) |
|---|---|---|---|
| Desktop, brush | 13.7 / 45 → **4.2 / 4.4 ms** | 62.6 / 137.7 → **4.2 / 7.9 ms** | 33.4 / 83.4 → **4.5 / 8.5 ms** |
| Desktop, taps | 12.6 / 33.2 → **4.2 / 4.4 ms** | 4.2 / 155 → **4.2 / 6.7 ms** | 28.8 / 48.9 → **4.3 / 8.6 ms** |
| Phone ×4 CPU, brush | 29.1 / 34.1 → **4.2 / 8.4 ms** | 70.6 / 91.6 → **4.2 / 9.8 ms** | 33.6 / 54.4 → **4.4 / 8.7 ms** |
| Phone ×4 CPU, taps | 28.1 / 33.6 → **8.3 / 15.8 ms** | 58.2 / 169 → **4.3 / 8.3 ms** | 37.5 / 50 → **4.3 / 8.5 ms** |

4.2 ms is what an idle frame costs on this machine: selection no longer shows up in a frame at
all, at any density, on either platform. Clearing 500, a 300-unit rectangle and 60 brush frames
all improved with it; a rectangle's one batch went from 4.4 to 13.5 ms on Europe Administrative,
which is 300 paths being made rather than 300 attributes written, and is a single frame's work.

Verified against the build before it: with **nothing selected the map is pixel-identical** (0
differing pixels on Europe Administrative and in flags mode), and with a selection the difference
is confined to antialiasing along selected edges — 62 pixels of 898,416 differ by more than
64/255, where a neighbour's hairline used to overdraw a selected edge. Checked with 8 and 60
selected, hovered-while-selected, in Data mode, in Flags mode, coastlines-only, over the USA map's
insets (the copies carry the same clip), over merged bodies, and zoomed 6× into Europe
Administrative. Clicks still reach the land through the layer, which never takes the pointer.

**Two other things profiling found, and one it cleared:**

- **A data edit repainted the whole map.** Any change to `doc.countries` invalidated every
  entity's paint, so giving 50 countries a value repainted all 2,659 of Europe Administrative.
  The paint cache now compares the entries one by one and repaints those that changed, which is
  the same answer: verified identical against a forced full repaint after values, a domain
  change, a cleared value, a label, a selection, comparison groups and a palette change, on the
  World map and on Europe Administrative.
- **The flag warm-up ran on a timer, not on idle.** It asked for its slices with
  `{ timeout: 3000 }`, which means "run within three seconds whether or not the browser is idle",
  and on a 2,659-entity map those forced slices went on arriving for minutes, landing in the
  middle of whatever the author was doing. It now asks for genuine idle time, uses the deadline
  it is given, and never starts an entity that the remaining time cannot hold. On a phone the
  worst idle frame on Europe Administrative went from 83 ms to 4.3 ms.
- **The Inspector** rendered a card per selected entity and re-rendered all of them on every
  pick. The cards are memoised on what they draw, so one arriving renders one. It was never the
  bottleneck — 8 ms with 200 selected — but it is 4× that on a phone.

**Already doing the minimum, and left alone.** Counters on every heavy memo showed that a
selection change recomputes no labels, no water, no merged geometry, no overlays, no flag tiles,
no coasts, no line networks and no projected land — one paint, one element, one chunk, one
render, in every mode. The gestures already batch: the brush collects everything a frame touched
and hands it over once. The store's own work is 0.1 ms.

**What costs what it has to:**

- **A theme switch or a style change that alters every paint repaints every entity.** About half
  a second on the USA subdivisions in the dev build; much of that is React's development-only
  checks, which the production build does not run.
- **A rectangle or a brush stroke across thousands of units** costs about 23 µs per unit it
  changes.
- **An SVG export of the USA subdivisions** serialises 45 MB in 0.64 s.

### A tap is a tap, not a pan

**A press is not a gesture until the finger moves.** d3-zoom starts a gesture on the press,
and the canvas used to take that as its cue to turn navigation on: `navigating(true)`, which
sets `pointer-events: none` on the zoomed group so nothing is hit-tested while the map is
moving. Released 120 ms later, that is exactly the window the browser's click lands in — so
the click reached the background rectangle behind the map and selected nothing. Every tap on
a phone, and every mouse click whose finger moved even slightly, on every dataset.

It had been live since the Europe performance commit, and the tests did not see it because
they dispatched events straight at the paths, which skips the browser's hit-testing — the
one thing that was broken. Every selection check now drives real input through the debugger
protocol (`Input.dispatchTouchEvent`, `Input.dispatchMouseEvent`) and lets the browser decide
what was hit.

Three fixes, all in `MapCanvas.tsx`:

- **Navigation is switched on by movement, not by the press.** The zoom handler compares the
  live transform against the one the gesture started from, and only past the slop does it
  suppress hit-testing. A press that never moves never suppresses anything, so its click
  reaches the land.
- **The slop is what a finger actually does:** 6 px with a mouse, 10 px with a touch, since a
  thumb never leaves a pixel alone. The zoom behaviour is given the same figure as
  `clickDistance(6)`, because d3 otherwise cancels the post-drag click itself — its default
  tolerance is zero, which is why a 3–4 px wobble on a desktop selected nothing either.
- **A drag through the sidebar's grip bypasses the gate entirely**, since there the finger is
  nowhere near the map and suppression costs nothing.

**A direct hit beats a catchment.** The small-entity assist gives anything drawn under 44 px a
catchment around it, and a tap inside one that misses the entity still selects it. That could
outvote the entity the finger was actually on when that entity is itself small — a French
commune selecting Monaco, a Latvian municipality selecting its neighbour — because the
assist's "standing on plain land" guard only knows the islands it carries. So a hit that lands
squarely on an entity smaller than the assist target is now taken as given, before the
catchments are consulted. The measurement is cached per entity and dropped whenever the zoom,
the assist index or the land changes; an A/B against a build without the rule puts hover
frames at the same median, p90 and max, so it costs nothing measurable.

Verified with real input on both platforms, on the World map at all three resolutions, Europe
Administrative, the administrative world and the Official USA counties:

- **Phone:** taps select and deselect at every entity size; a 7 px wobble still selects; a
  drag and a pinch select nothing; six rapid taps select six; selection works after panning;
  landscape behaves as portrait.
- **Desktop:** the same, plus Shift multi-selection (which was broken by this too), the
  rectangle (31 entities on a middle-button drag) and Brush Mode (5), and a plain click still
  works after using either tool.
- **The grip is untouched:** one store write per drag, nothing selected, no sidebar scroll,
  and the pinch still reaches k 15.
- **Selection frames are unchanged**, 4.2 ms median everywhere, with Europe Administrative's
  p90 slightly better than before.

### Moving around the map

**The map is drawn as vectors on every frame of a gesture, at the camera the gesture has
reached.** Each line is at its true screen width on every frame, never a stretched picture of an
earlier one.

**An earlier optimisation was reverted.** It moved an already-drawn picture of the map during a
gesture and redrew it when the gesture rested or ended. Its faults:

- Borders grew while zooming in and thinned while zooming out, then snapped back at every redraw.
- Lines looked soft while moving.
- It was slower on phones. The picture carried a margin of about four screens' worth of pixels,
  so every redraw drew roughly four times the area, and it added redraws in the middle of
  gestures.
- It restyled every map element at the start and end of each gesture.

It was reverted whole. The rebuilt bundle was byte-identical to the build from before it.

Two changes were then made again, each only after showing it draws exactly what the stable
renderer drew and is no slower on any profile (`MapCanvas.tsx`, the zoom behaviour, and
`CountryPath.tsx`):

- **The camera is set at most once per frame.**
  - A gesture's camera waits for the next animation frame and is set there.
  - A trackpad reports a pinch at 120 Hz and a phone its fingers as fast as they move, so the
    old code set the camera twice for each frame drawn.
  - It also set it inside the touch event, and d3-zoom's pointer maths in the next event then
    forced a synchronous layout of every outline. On a phone-speed CPU that was 9–10 s of
    blocked script in a one-second pinch on the Detailed World Map; now it is 0.3 s.
- **Lines are drawn in the map's own units, their width following the camera in the same
  frame.**
  - The width is `px ÷ camera scale`, via `screenStrokeWidth` and `--map-k`. A uniform scale draws
    a stroke exactly as it draws the path at the scaled size, so on screen it is the line
    `vector-effect: non-scaling-stroke` drew.
  - The browser no longer transforms every vertex of every outline into screen space again
    whenever the camera moves, which is what non-scaling strokes cost.
  - The scale is set in the same frame as the camera's transform: by the zoom behaviour during a
    gesture, and by React when the camera is committed. No frame draws a line at another width,
    and a pan, which changes no scale, restyles nothing.
  - Every map line uses this one method: outlines, coasts, merged bodies, border networks,
    lakes, rivers, the sphere, the graticule, island water and flag territories. Overlays and
    the magnifiers keep non-scaling strokes; they are a handful of paths.
  - Exports get the resolved width written onto each path.

Verified in headless Edge on the real GPU, against the saved build of the stable renderer:

- **Every frame is the settled picture.** A frame drawn while two fingers are held mid-pinch, and
  the frame after they lift at the same camera, differ in 0 pixels, on both builds. The border
  measures 0.8 px in both.
- **Same look as the stable renderer.**
  - The Modern World, the Detailed World Map and flags with island water are pixel-identical at
    fit.
  - Zoomed over Germany (both maps) and over the Caribbean with flags, 99.4–99.9 % of pixels are
    identical. The rest differ by antialiasing on line edges, and magnified eight times the lines
    have the same width.
- **Nothing is doubled.**
  - Every listener is registered once, the same on both builds.
  - The same 4,034 paths are drawn before and after gestures.
  - The map is never moved as a picture.
- **The camera is set once per frame, not twice.** For example, 61 writes in 60 frames of a touch
  pinch, against 121 in 62 on the stable renderer.

Before → after: how long about a second of input took to play out, stable renderer → now. Each
figure is the mean of two runs, in headless Edge on the real GPU with real input. The phone
profiles slow the CPU fourfold; the GPU runs at full speed, as it always does here.

| | Modern World | Detailed World Map (4,030 units) |
|---|---|---|
| Desktop: drag / wheel / trackpad pinch | 4.7 → 4.1 / 1.6 → 1.4 / 9.0 → 7.7 s | 12.7 → 11.4 / 4.2 → 3.7 / 23.1 → 20.4 s |
| MacBook 1440×900 @2×: drag / wheel / pinch | 5.0 → 4.1 / 1.8 → 1.45 / 8.4 → 7.3 s | 12.5 → 11.6 / 5.0 → 4.4 / 22.4 → 19.0 s |
| Phone portrait: drag / pinch / two-finger pan | 3.9 → 3.3 / 4.5 → 3.7 / 4.0 → 3.3 s | 12.3 → 11.1 / 11.7 → 10.4 / 12.1 → 11.1 s |
| Phone landscape: all three | 0.95 → 0.95 s | 0.95 → 0.95 s |

Main-thread time fell further than wall time:

- A desktop drag on the Detailed World Map kept the page busy for 12.2 s. Now it is 1.0–1.5 s,
  so the page stays free to take input.
- A phone pinch there ran 9.3 s of script. Now it is 0.3 s.

**What remains** is the graphics card drawing every outline again on each frame: about 4,000
detailed ones on the Detailed World Map. That is the price of crisp lines at their true width on
every frame with no geographic detail dropped. The two ways past it are a moved picture (rejected
above) and fewer vertices per outline at low zoom (not done: it drops detail).

### Trackpad pinch

A pinch on a trackpad zooms the map and never the page. It used to zoom the whole document
on a MacBook: the toolbar, the sidebar and the legend scaled away like an image and came back
on the way out. A pinch reaches the page in one of two forms, and both were left to the
browser (`src/render/pinchZoom.ts`):

- **Chromium and Firefox** send it as `wheel` events with `ctrlKey` set. The map's zoom
  filter refused every event with Ctrl held, so the map never saw the pinch and the browser
  zoomed the page with it. The filter now lets a ctrl-wheel through, as d3-zoom's own filter
  does. d3-zoom still leaves one alone when it would change nothing — at either end of the
  zoom range — and never sees one over the sidebar, so a listener on the window cancels
  every ctrl-wheel. It is registered with `passive: false`, which is what allows the cancel
  to stop the page zoom.
- **Safari** sends `gesturestart`, `gesturechange` and `gestureend` instead, with the pinch's
  running scale. Those are cancelled the same way, and over the map each step is handed to
  d3-zoom as the ctrl-wheel the other browsers send. The map zooms through the one pipeline,
  with the same limits, the same point held under the pointer, and one commit when the
  pinch goes quiet.

Over the sidebar, the toolbar and the other panels a pinch does nothing, and ordinary
scrolling there is untouched. A pinch with fingers on a touch screen is left alone: d3-zoom
handles it on the map, and the browser zooms the page elsewhere as it always has. The
keyboard's zoom shortcuts are left alone too, so a larger page is still one Cmd/Ctrl + away.

Verified with the events each browser sends, across the whole path:
- ctrl-wheel over the map zoomed it (1 → 3.48 → 2), and every event was cancelled;
- over the rail and the toolbar, and at the zoom limit (40), the events were cancelled and
  the map stayed where it was;
- Safari gestures zoomed the map by exactly the pinch's scale, and were cancelled over the
  map and the rail alike;
- a touch pinch was not cancelled;
- a plain wheel still zoomed the map, and scrolled the panels without being cancelled;
- the page's zoom never changed (`devicePixelRatio` and `visualViewport.scale` constant).

### Themes

`theme/themes.ts` holds three themes, each split into two parts:

- `ui` — interface tokens written onto `document.documentElement` as CSS custom
  properties. No component hardcodes a colour; the stylesheet only ever reads
  `var(--…)`, so a new theme is one entry in that file and nothing else.
- `map` — the map's own colours, applied through the normal `set_style` operation.
  Map colour is map *content*, so it belongs in the document and in an export;
  interface chrome does not.

Each theme defines a five-level surface ladder — backdrop, panel, section, control,
inset — with steps large enough that the interface reads without borders doing all
the work. **Dark** is soft graphite (`#20252c` backdrop, never black) with blue-white
text and a clear sky-blue accent. **Light** is daylight grey with panels *lighter* than the backdrop,
so no field of pure white dominates. **Geographic** is warm stone chrome over a
layered sea, graticule on by default, hairline boundaries.

Neighbouring countries in the Geographic theme get slightly different land tones.
The group index comes from **graph-colouring real adjacency** in `geo/metrics.ts`,
computed once per dataset from geometry alone. It is a legibility device — the same
job a political map's colouring does — and says nothing about the land. It is not
elevation. The `terrain` and `bathymetry` ramps are defined but deliberately unused:
hypsometric shading needs an elevation raster and bathymetry needs sounding data,
neither of which country outlines provide, and neither is invented here.

Theme switching only re-reads a palette — it never touches geometry, so it costs
1–4 ms even on the 10m dataset.

The theme and the selection highlight persist to localStorage, and writes are
**debounced**. `localStorage.setItem` is synchronous and the selection-highlight well is
dragged rather than clicked — it fires on every input event, so one drag was serialising
and writing the whole preferences object sixty times a second on the main thread.
The store still updates immediately; only the trip to disk waits, and the last write of a
drag is the one that matters. Measured: a 41-step drag now performs **zero** writes while
dragging and one after it settles, with the final value persisted.

**Selection highlight** is a third preference alongside them: a colour well and five
quick presets for the colour a selected country is filled with. It lives in
`settingsStore` rather than in the document, because it is a property of the person
editing rather than of the map — so it survives a reload, stays out of exports and off
the undo stack, and never travels with a saved file.

Unset by default, meaning "whatever this theme selects with". Each theme already picks a
selection colour that belongs with its palette — the Geographic theme's green, the other
two's blues — and defaulting to a literal would have restyled the themes nobody was
complaining about. So the well shows the colour actually in use, and setting it pins that
choice across every theme until "Use theme colour" hands it back.

The substitution happens **once**, where `MapCanvas` builds the style it draws with,
rather than at each place a selection is drawn. The fill, the outline, the contrast
casing and the anchor handles all read `style.selected` and `style.selectedOutline`, and
substituting at the source is what makes it impossible to miss one. The outline moves
with the fill — re-anchored through `reanchorTone`, the single-colour case of the land
tint derivation — or a red selection would be ringed in the old theme's green.

It ranks exactly where selection already ranked, which is below anything a mode decided:
a selected country in Data mode still shows its ramp colour, and a selected country in a
comparison group still shows its group's.

Each setter persists the whole of the current state rather than naming the fields it
knows about. Listing them meant every new preference had to be added to every existing
setter, and the one that got missed would quietly wipe it on the next unrelated change.

### Geographic layers

Countries are one layer, lakes are another. `geo/lakes.ts` loads its own data, has its
own registry and its own style tokens, and never touches the country geometry: water is
drawn over the land, so a border never decides whether a place is land or water. A future
layer (glaciers, urban areas) is another module of the same shape rather than a change to
the country data.

The lake data is the curated inland-water layer every map shares — all 1,355 of Natural
Earth's 10m lakes and its Europe and North America supplements, 3,283 bodies of water — see
*The geographic foundation* below. It used to be cut to the most prominent 336, which drew
the Dniester liman, the Danube delta's lakes and a thousand more as land.

Two lakes on most people's list are deliberately absent from the layer: Natural Earth
treats the **Caspian Sea** and **Lake Maracaibo** as marine, and both are already
gaps in the country polygons, so they render as water without a lake polygon. The
Aral Sea appears as "North Aral Sea" and "South Aral Sea", which is its correct
modern two-basin form.

Every lake is drawn as a single path. They share one style and are never
individually addressable, so one element is cheaper and simpler than 300+ nodes, and
it is memoised on the projection exactly like the country paths — a theme change, a
pan or a zoom re-reads a colour and never rebuilds the geometry.

Lakes keep pointer events but carry no `data-country-id`, so hovering or clicking one
picks nothing rather than picking the country underneath, while a microstate's assist
zone still wins over the water.

### Water Regions

**Display → Geographic Features → Water Regions** puts the sixteen major oceans and seas on the map as entities:
things that can be hovered, selected, coloured, put in the legend and exported, the way a
country can. Off by default, and off it changes nothing at all — no geometry is fetched,
nothing is drawn, the sea is the background colour it always was, and a click on the water
picks exactly what it picked before, which is usually nothing.

The regions are the Pacific, Atlantic, Indian, Southern and Arctic oceans, and the
Caribbean, Mediterranean, Black, Baltic, North, Red, Arabian, South China, East China,
Japan and Caspian seas. Sixteen, deliberately: Natural Earth's marine layer names 118
features, and a hundred selectable bays would be a hundred things to click past on the way
to the Mediterranean.

#### The geometry is real

One shared dataset, `data/natural-earth/waters.geojson`, built once by
`scripts/build-waters.mjs` and committed like every other curated layer — so an ordinary
build only copies it and stays offline. The source is Natural Earth's 1:50m marine
geography: real marine polygons whose outlines follow the coast, with a hole for every
island the source cuts out. Nothing is a circle, a rectangle, a bounding box or a
screen-space mask, and nothing was drawn by hand.

Three things are done to it, each of which is a fact about the source rather than a
liberty taken with it:

1. **The parts of a region are unioned into one shape.** Natural Earth splits the Pacific
   and the Atlantic at the equator, and cuts every marginal sea and gulf out of the ocean
   around it — so sixteen features on their own would leave the Pacific full of holes where
   the Philippine, Coral, Bering and thirty other seas had been. Each of those features is
   folded into the region it belongs to, following the IHO's *Limits of Oceans and Seas*
   where it settles the question: the Norwegian Sea is Atlantic, the Greenland Sea is
   Arctic, the Gulf of Bothnia is Baltic. `PARENT` in the build script is that table, one
   line per feature, and a feature a future edition adds that the table does not name stops
   the build rather than vanishing from the map.
2. **The water the layer names nowhere is given to the region beside it.** Natural Earth's
   marine layer is a layer of *named areas*, not a partition of the ocean: the western
   Aegean, the Sea of Azov, the Sea of Marmara and the pockets behind a hundred coasts
   belong to no feature in it — about 1% of the sea, all of it against a coast, which is
   exactly where somebody zooms in. Those gaps are cut from the ocean itself (the world
   minus Natural Earth's 50m land, so their edges are real coastline with a hole for every
   island) and each joins the region it shares a boundary with, or the nearest one within
   25 km where clipping left it sharing no vertex. Which is also what settles the lakes:
   Superior, Victoria and the Aral are hundreds of kilometres from any sea, nothing claims
   them, and no ocean is ever painted across a lake.
3. **Everything is cut at 60°S**, the Southern Ocean's defined northern limit. This is the
   one place the source has two features over the same water — its `SOUTHERN OCEAN` is a
   narrow label polygon hugging Antarctica while the Indian, Pacific and Atlantic sheets run
   down to the continent — and the parallel is the definition rather than an approximation
   of anything.

The result is sixteen regions covering 363.5 of the world's 363.4 million km² of sea and
lake, with no overlap; the excess is two coastal lagoons the lake layer draws over anyway.
The build refuses to write a file that fails its own checks: every marine feature placed,
every region non-empty, no two regions overlapping (sampled), and a total between the marine
layer's own area and the area of water there is. Measured against the published figures the
regions come out where they should — the Mediterranean at 2.52M km² against 2.5M, the
Caspian at 0.40M against 0.37M, the Southern Ocean at 21.9M against 20.3M.

At 1 MB it is the third-largest layer the editor loads, after the rivers and the maritime
zones, and like them it is fetched the first time the switch is turned on and never before.
50m rather than 10m for a reason: the water is drawn *under* the land, so its landward edge
is covered by whichever coastline the map is drawing, and what this layer has to get right
is the extent — where the Mediterranean ends and the Atlantic begins — which the 50m edition
states as well as the 10m one in a file a phone can hold.

#### Water is not land, and the ids say so

A water region is not a country, a province, a territory or an administrative unit, and the
separation is structural rather than a matter of care at each call site:

- every id begins `water-` — `water-baltic-sea` — which no country (`FRA`, `X..`),
  subdivision (`US-CA`, `DEU-3488`), merged body (`merge-…`) or overlay (`overlay-…`) id
  can look like, so `isWaterId` is a total answer to "is this a sea?" wherever an id turns up;
- the selection keeps them apart: `selectedWaterIds` beside `selectedCountryIds`, and the
  store's own selection actions route by that prefix. Everything that reads the land
  selection reads it to do something to countries — give them a value, group them, merge
  them, copy them as an overlay — and a sea can be none of those, so it is never in that
  list. Selecting a sea leaves the land selection exactly as it was, and the other way round;
- the paint lives in `doc.waters`, beside `doc.countries` rather than in it, and holds only
  a colour and an opacity: a region's geometry, name and extent are geography and nothing in
  the document can change them;
- the operation vocabulary refuses a sea wherever land is named. `create_merge`,
  `update_merge`, `add_to_group`, `add_to_comparison`, `set_country_value` and every other
  operation carrying a `countryId`, `countryIds` or a merge's `members` rejects a `water-`
  id with a reason rather than filtering it out silently — *"Pacific Ocean" is a water
  region, and water is never land: it cannot be used here*. The two water operations refuse
  the opposite mistake: `set_water_paint` with a country id is an error, not a no-op;
- **Merge Mode ignores water outright.** A tap on the sea while the panel is open does
  nothing — no group is created, nothing is added, and nothing is selected — because a merged
  body is a body of countries and a sea can never be in one.

`set_water_paint` is the only operation in the vocabulary that sets a colour directly, and
that is the same argument as the one ruling out `set_country_color` reaching a different
answer: the modes that colour the land read values, groups and countries, and none of them
has anything to say about the Mediterranean, so there is no mode for the paint to outrank.

#### Drawn under the land

The layer is the first thing inside the camera, beneath the graticule, the flags' island
water, every country path and the lakes. That ordering is the whole of the containment rule
— the same one the maritime layer relies on — and it is what keeps every coastline, island,
narrow channel and lake exactly as it was: they are painted over the water afterwards. It is
also why a selected sea is not lifted above the land. Lifting it would bury the islands
inside it, which is the opposite of respecting the coastline; under the land it reads
correctly already, because the water is only ever visible where there is water.

An ordinary sea draws nothing: no fill, no outline, no border, no halo. What the shape
carries is `pointer-events: all` — which is what makes a region something the pointer can
find before it has any colour — and a `<title>` with its name, so a sea names itself in the
hover read-out and the status bar the way a country does. Paint resolves in the order a
country's fill resolves: selection first, because selection *is* a fill on this map, then the
author's colour at its opacity, then hover, which only ever tints what nothing else has
coloured. Hover on the sea is deliberately lighter than the land's: a hover on the Pacific
covers a third of the map, and at full strength the whole picture flashes as the pointer
crosses it.

Sixteen paths and about 58,000 vertices — a fraction of any country layer — projected once
per projection change and never again: panning, zooming, hovering, selecting and painting a
sea reproject nothing, because the camera moves the group they sit in exactly as it moves the
land. Insets are deliberately not consulted: an inset frames the land of Alaska or Hawaii,
and the sea inside one stays the map's background water.

#### Selecting a sea

Everything that selects a country selects a sea: a click or a tap (which toggles, so tapping
seas one after another builds a selection and tapping one again takes it out), Shift-click,
the rectangle, and Brush Mode, which paints them in as it passes over them. The two
selections are counted separately in the status bar — *3 selected, 2 water*.

**Land wins every point it covers.** A click asks for a country first, through exactly the
path it always used — visible land, then a microstate's assist catchment — and only a point
that no land claims reaches the water. So a click on Italy selects Italy even though the
Mediterranean's polygon runs underneath it, and a click a few pixels off Malta still selects
Malta. Measured on a phone, on identical points inside a sea, the entity a tap on land
resolves to is byte-identical with the layer on and with it off.

The cost of that rule is that the catchments, which reach 22 screen pixels past a speck of
an island, hold the water around them: on a 400px-wide phone at world zoom about half the
Pacific answers a tap and very little of the island-strewn Atlantic does — St Helena,
Ascension and Tristan da Cunha alone cover most of the South Atlantic at that size. Three
zoom steps in, 21 of 24 sampled points in the Atlantic answer. This is the existing
precedence rather than anything new: before this layer those same taps selected those same
island nations, and the remedy is the one the map already offers — zoom in, or take the sea
with the brush, which tests the outlines as geometry and never consults a catchment.

#### Colour, legend and export

The controls appear under the switch in Display while seas are selected, like the country
names' controls above them: a colour well, an opacity slider, and *Use the map's own water*,
which takes the paint off entirely — the regions leave the document rather than keeping a
colour nobody can see, so a map with nothing painted carries nothing and exports as it always
did. Painting is one operation on the whole selection and one undo step, and dragging the
well or the slider coalesces into that one step.

A coloured sea appears in the legend as a row of its own, in the regions' own order, in every
mode that has rows — colouring off, a threshold scale, a comparison, and flags, where it is
the only thing the legend has to explain. A numeric scale is the exception: its legend is a
ramp, and a ramp has no rows to add to, so a swatch list under a gradient would be a second
legend inside the first. Selection is deliberately not in the legend, exactly as a selected
country is not: it is the editor showing what is in hand, not a statement the picture makes.

Exports carry the water because the layer is part of the map's own SVG — PNG, JPG and SVG
alike, at any scale, with the colour and opacity as drawn.

#### What was checked

On the World map, the administrative world (3,153 units), the USA States map and the
Official USA Administrative Map; in the automatic, Mercator, orthographic, Equal Earth and
Robinson projections; at world zoom, 3× and 12×; framed to the world and to Europe; and at
desktop (1280), MacBook (1440@2) and phone (390@3, real touch input) sizes.

- Off by default: nothing fetched, nothing rendered, and a click on the sea selects nothing.
- On: sixteen regions drawn, every one with geometry, every one before the first country path
  in the document, and not one stroke anywhere in the layer.
- A tap selects a sea and no land; a second sea joins it; a third tap takes it out again.
- A click on land selects land and leaves the water selection untouched, and the entity a
  land click resolves to is identical with the layer on and off.
- The rectangle took the Black Sea together with the six countries around it; a brush stroke
  took four seas across the Indian Ocean.
- Colour and opacity applied to the selection, survived deselection, and undid in one step.
- The legend listed *Mediterranean Sea* with colouring off and among a threshold scale's
  bands; the export SVG carried the painted Atlantic.
- Merge: a tap on the Pacific in Merge Mode created nothing and selected nothing, and the
  five malformed operations above were each refused with their reason.
- Navigation on the phone profile with the densest dataset (4,030 admin units at zoom 7.3):
  pan, pinch and two-finger pan all within noise of the same run with the layer off — 49 more
  DOM nodes and no measurable change to any frame statistic.

### No minimum rendered size

Every entity is drawn at its true size, through the same zoom transform as the land
around it, so zooming in never makes one smaller and zooming out never makes one larger.

There used to be a floor: `minimumSizeTransform` scaled any feature smaller than 3 px on
screen up to 3 px for the current zoom, and flag mode did the same per island for
scattered countries. Held at a constant size on screen, those specks — Vatican City,
Monaco, San Marino, a Maldivian atoll — grew against their neighbours as the camera zoomed
out and shrank as it zoomed in, the opposite of everything else on the map, and their
proportions were wrong at every zoom but one. Both floors are gone. A speck is drawn as the
speck it is (its outline stroke keeps it a visible dot), the pointer finds it through its
assist catchment, which is sized in screen pixels and draws nothing, and the magnifier
shows a selected one enlarged in a lens beside it — an overlay, never the map.

**Vatican City is the one exception, and it is a constant factor, not a floor.** At its true
size — about a kilometre across — it is 1.4 px on a desktop window even at the map's deepest
zoom (40×), so there was no zoom at which it could be seen or aimed at, and it read as missing
from both world maps. It is now drawn six times its true size about its own centre, on the
Modern World map at every resolution and on the administrative world: the smallest whole factor
that makes its outline a target of more than 8 px at that deepest zoom (8.6 × 6.5 px). Everywhere
else it stays as small as it can be — 0.2 px at world zoom, 1.7 px with Italy filling the window,
3.4 px at 16× — and 16 km² as drawn, still smaller than San Marino and a quarter of the Rome
district it sits in. It does outdraw Monaco, which is drawn at its true 2 km².

Because the factor is on the geometry rather than on the screen, it has none of the old floor's
faults: it grows and shrinks with the camera exactly as Rome does, and every consumer sees one
outline — the path, hit-testing, the assist catchment, flag framing, labels, overlays, merges and
every export. It is the real traced outline (`geo/supplemental.ts`, `enlarge: 6`), not a circle,
box or marker, and it sits where the state is: its centre is 12.4558°E, 41.9039°N against the
real 12.4534°E, 41.9029°N. Paint order is by area, so it is drawn over Rome at any size, and the
assist catchment that reaches past every speck still supplies the full touch target — on a phone,
where the same deepest zoom draws it at under 3 px, that catchment is what a finger lands on.

Merged, it keeps that outline. A merge dissolves its members' topology arcs, and Vatican's arcs
are Natural Earth's placeholder — or nothing at all on the 110m map — so a supplemented member
is now carried into the group as it is drawn, the way an island that shares no arc with anything
is. That also means a supplemented speck on the 110m map no longer drops out of a group.

Checked on both maps: drawn after its host at 1×, 8×, 16× and 40×; a click on its own shape at
40× selects it; a value colours it; merged with Italy (or with Rome, on the administrative map)
it becomes one body; its flag fills it in Flags mode on the World map; its name is set from 16×,
as Monaco's and San Marino's are; and its outline is in the SVG export. Present at 10m, 50m and
110m.

### Manual editing

Selecting a country now leads somewhere. The value field holds a draft while you type
and commits on Enter or on losing focus, rather than writing on every keystroke: typing
"1.5" passes through "1.", which is not a number, and one committed edit is one undo
step instead of one per character. With several countries selected the same field
writes to all of them as a single batch, and shows their shared value only when they
actually agree — showing one country's number as if it were all of them is a lie the
field would then commit on blur.

The inspector edits a name and a value, and nothing else. There is no per-country
colour control and no per-country colour in the document: colour is decided by the
active colouring mode, from the value edited here or from the groups a country belongs
to. An override would always win, so a map carrying a handful of them is a map where
some countries answer to the palette and some silently do not, with nothing on screen
saying which — the way to change a country's colour is to change its data.
`clear_country_value` removes a value and leaves the name; `clear_country` wipes the
entry.

**Groups** are author-created collections: a name over a set of ids. Nothing is
merged — members keep their own geometry and values, and a country may
belong to as many groups as you like, so Iberia and the Roman Empire can both contain
France. A group carries its own `properties` alongside its members', deliberately:
setting a group's value never writes to its members and the reverse, which leaves
open what a future colour scale should read. Geometry merging is a separate operation
(`merge_group_geometry`, reserved and unimplemented), and keeping membership logical
until then means creating a group costs nothing and undoing one cannot damage the map.

`create_group` carries the id it is creating rather than minting one in the executor.
An operation has to be able to say what it did: a log replayed twice must produce the
same document, and an assistant that creates a group and then renames it needs to know
what to name. Ids come from `nextGroupId(doc)`, derived from the document so the same
document always yields the same next id.

### Land colour, and the tinted themes

Three controls set the base appearance: **Background** (the water), **Land**, and
**Border**. Background always worked. The other two did not, in different ways — the
border above, and the land here.

The Geographic theme separates neighbouring countries with several closely related
khakis rather than one flat fill, which is the whole of its look, and the per-country
tint outranks `style.land` when a fill is resolved. So on that theme the Land swatch
moved and the map did not.

Replacing the family with the author's single colour would have deleted the look;
ignoring the author was the bug. So `deriveLandTints` treats the palette as a set of
**relationships** rather than a set of colours: each tone's distance from the theme's own
land tone is measured and re-applied to whatever base is chosen — hue and lightness as
offsets, saturation as a ratio. A green base gives closely related greens, a red base
closely related reds, and the theme's own khaki reproduces the original palette
byte-for-byte.

Saturation is a ratio rather than an offset so a grey base stays grey: adding the khakis'
saturation would introduce a colour cast nobody asked for, where scaling zero leaves
zero. And the family is *shifted* as a whole when it would run off either end rather than
each tone being clamped where it lands — clamping collapses the spread exactly where it
is most needed, pinning every tone of a black base to the floor and flattening the map.
Measured across nine bases from pure black to pure white: the lightness ordering and the
0.0588 spread are identical in every one, with five distinct tints throughout.

These are **base** settings and rank below anything a mode decided. Verified with a loud
green land under every mode: the palette ramp, the threshold bands, the comparison group
colours, the per-country flags and the world-domination pattern all survive it, and a
comparison map's neutral countries are the ones that take the derived tint.

### Colouring

Three mutually exclusive modes, because a map answers one question at a time — and
**Data** splits again into the two ways a number can become a colour.

  `[ Off ] [ Data ] [ Compare ]` → when Data: `[ Palette ] [ Predefined ]`

The second row is a row rather than four entries in the first, because the two
questions are not siblings: "am I colouring by data or by group?" comes before "which
kind of data scale?", and flattening them would put Compare next to HDI.

**Data** runs the active layer's values through a sequential palette: three families —
blue, red, green and a blue→red **Diverging** ramp — each at six or nine steps. Every ramp runs **lightest first**, so
index 0 is the lowest value and the palest shade and the map darkens as the numbers
climb — more of the thing being measured reads as more ink, and the mapping is
monotonic, so a larger value can never come out lighter than a smaller one. The stops are ColorBrewer's sequential schemes reversed,
chosen for perceptual evenness: equal steps in the data look like equal steps in the
colour, which a hand-picked ramp almost never manages. Six is enough for most maps and
stays readable in a legend; nine earns its place when the data spreads far enough.
Countries with no value are not given a data colour — they fall through to the land
colour, so "no data" never reads as "low".

Values never reach a palette raw. The scale is **normalised across the document**:

    t = (value − min) / (max − min)

with `min` and `max` taken from every country that currently holds a number. So
10–90, 100–900 and 0.1–0.9 all colour the same map, and `t` takes the nearest of the
ramp's six or nine evenly spaced stops — the lowest value on the palest, the highest
on the darkest. Assigning a value anywhere rescales everything, which is the point: a
choropleth's colours mean a country's position in the distribution, not its number.

The domain is read from the **document**, never from the selection. Those answer
different questions — the selection answers "which countries will my next edit apply
to", the document answers "which countries have a value" — and letting the second be
computed from the first is what makes a map appear to forget the batch that was
coloured a minute ago. A domain with no spread (one valued country, or several that
agree) has no relative position to report, so it answers 1 — the darkest stop, and
never a NaN. Every such country is both the minimum and the maximum, and reading it
as the maximum is what keeps five countries at 100 dark when four countries at 70
arrive underneath them.

**Selection does not colour.** A selected country keeps whatever colour its value
earned it and is marked by an outline instead — selection is a statement about the
next edit, not about the data, and a map that repaints five countries for as long as
they are selected is lying for exactly as long. The outline's casing is chosen from
the fill it lands on, because a ramp running from near-black to near-white defeats any
single outline colour; the theme's own selection colour rides on top of it. Only a
country the active mode leaves uncoloured is available for selection and hover to
paint, and only then does `style.selected` appear as a fill.

The diverging ramp is a different shape on purpose: dark at both ends, pale in the
middle, because what it shows is distance from the centre of the range in one of two
directions. The same normalised position drives it — only the colours at each end
differ.

**No ramp reaches white.** ColorBrewer's sequential schemes open on `#f7fbff`,
`#fff5f0` and `#f7fcf5`, all within a couple of percent of paper, and RdBu's centre is
a flat `#f7f7f7`. On a map those stops are indistinguishable from blank, so a country
at the bottom of the scale reads as a country with *no data* — the one thing a
choropleth must never say by accident. The two palest stops of each scheme are dropped
and the ramp rebuilt from what is left; the diverging centre is a light lilac-grey.
Every stop stays under a relative luminance of about 0.90, clear of the lightest land
tone any theme uses.

**Predefined** is the other way to read a number, and the difference is what the
colour is measured against. The palette scale asks *"where does this country sit
between the lowest and highest value on this map?"* — relative, and it moves when the
data moves. A threshold preset asks *"which published band is this number in?"*, and
the answer does not depend on who else is in the frame. Put the twenty highest-HDI
countries on a map and the relative scale stretches them across the whole ramp,
painting the lowest of them in the colour it would give Somalia; the threshold scale
paints all twenty "Very high", because all twenty are. Nothing in `state/presets.ts`
reads `computeDomain`, and that is the entire point.

The first preset is **HDI**, using the four groups the UNDP has published since the
2010 Human Development Report — low below 0.550, medium to 0.699, high to 0.799, very
high from 0.800 — in ColorBrewer's colour-blind-safe RdYlBu at four classes. Adding
another is a `name`, a `unit`, a `source` and a list of bands appended to
`THRESHOLD_PRESETS`: the executor validates against the ids there, the renderer looks
the preset up by id, and the panel renders whatever bands it finds, so GDP per capita
or life expectancy costs one object and no code. Band colours are categorical and none
of them is near white either, for the same reason — a threshold map's lowest band is a
real reading, not an absence.

**Compare** is a separate mode, not a palette. It answers "which of these two" rather
than "how much", reads no values at all, and picks its own two colours. Sides are
assigned to *groups*, which is what the group system is for and what keeps the
assignment out of the countries themselves: a country can sit in groups on both sides
and nothing about its membership changes. Where that happens the tie is broken by
**document order** — the group created first wins — so the answer is the same on every
render, and it is stated in the panel rather than left to be discovered. Countries in
no assigned group stay neutral.

Turning comparison on suspends the data palette instead of blending with it; a map
that is simultaneously a choropleth and a two-way split is neither. Neither mode ever
writes to the document's values, so switching between them, changing palette, or
switching off recolours the map without touching a single stored number.

### Borders

A political boundary has one job, and a single colour provably cannot do it. The line
has to separate countries against the theme's land *and* against every stop of every
data palette, and those run from `#08306b` to `#c6dbef`. Measured as WCAG contrast,
the best single tone available bottoms out at **1.0–1.15:1** in each theme — not a
faint line but no line at all. The light theme's old `#a8afb8` sat at exactly **1.00**
against the middle of the Red ramp: the same luminance as the fill it was dividing.

So each theme supplies a **pair** — an ink and a pale tone — and `resolveBorderColor`
picks whichever measures better against the fill actually painted beneath. Not a
lightness threshold: a threshold assumes the pair sits symmetrically about it, and
these never do, which is how `#41ab5d` in the middle of the Green ramp ended up with
the tone *closer* to it at 1.5:1 when the other offered 6.6:1. Comparing the two
ratios cannot make that mistake.

Two tones chosen by one measured rule is not a colour per country: a map shows at most
two line colours, and which one appears is a legible consequence of how dark the
country is. On the dark theme the ink carries about four fills in five.

#### Coastlines and borders are one stroke

**Coastlines are off by default.** A fresh editor, and a fresh document on any map, draws borders without the coast, and the land meets the water at its own fill. Switching to another map keeps the current style, so a map where the author turned Coastlines on keeps it. Display → Geographic Features → **Coastlines** turns it on. No map, dataset, projection or region preset changes it. Of the templates, only World Domination turns it on, because it turns borders off and the land would otherwise have no outline at all. Predefined Data leaves it alone. Load times on the densest maps (US counties about 0.9 s, US county subdivisions about 3.5 s) are the same with Coastlines on or off.

A country path is stroked once, and that single stroke is both things at once: its coast
where it meets water, and its share of a boundary where it meets a neighbour — each of
the two countries drawing half of the same line. Which is why the **Coastlines** switch
cannot simply drop the stroke: the internal borders would go with it.

So when it is off the paths are not stroked at all, and the shared-boundary network is
drawn on its own instead. That network already existed for the flags mode's boundary
treatment: `mesh` walking the topology and keeping only the arcs whose two sides resolve
to *different* countries, which is exactly the set the coast is not in. It is drawn only
in the off state — with coastlines on, the paths have already drawn those lines and a
second copy would double their weight.

One line for a border rather than the two halves the paths drew, which is also why it
needs no per-country colour: a shared boundary belongs to both its countries equally.
Measured by diffing the two renderings pixel by pixel, coast points change substantially
(11–39 changed pixels in a 9×9 box at Senegal, Chile, Norway and Western Australia) while
internal borders barely move (1–9), the residue being antialiasing — two overlapping
half-strokes composite a shade darker than one.

Being a layer in the same SVG, it exports with everything else, and it holds across every
projection, colouring mode and flags mode: 0 stroked paths and 1 boundary layer in each.

**That rule is scoped to fills that come from a scale.** It used to run for every
country, which quietly made the Border swatch a suggestion rather than a setting: on the
dark theme the control read `#0d1116` while the map drew `#93a1b3`, because the pale
tone won the contrast race against the theme's own land — and a magenta chosen on the
light theme was discarded outright. A control that is only a *candidate* is not a
control. So `resolveBorderInk` returns `style.border` verbatim for the base map and for
comparison, and defers to the pair above only where a data scale actually colours the
country, which is the case it was built for. A monochrome map is expressible again:
black land with black borders stays black rather than being corrected into visibility.
Measured with a green land and a magenta border, Data mode draws exactly two line
colours — the chosen magenta, and the pale tone on the ramp stops dark enough to swallow
it.

|            | before        | after |
|------------|---------------|-------|
| Dark       | 1.09 worst    | **2.76** worst, 5.72 median |
| Light      | 1.00 worst    | **2.86** worst, 5.84 median |
| Geographic | 1.03 worst    | **2.86** worst, 5.33 median |

The Dark row was measured with its original border pair, `#0d1116` and `#93a1b3`. The
softer pair of the refreshed Dark theme, `#141920` and `#9eabbc`, scores **2.79** worst over
the same 38 palette stops. Measured the same way, the original pair scores exactly the 2.76
above, so the lighter borders gave up no legibility.

One stroke, never two. A casing pass would mean a second copy of every country's path
data — doubling the scene and the exported SVG — to buy contrast this already has.
`stroke-width` goes 0.6 → 0.8, which helps but is not the fix; `vector-effect:
non-scaling-stroke` then holds that weight constant from world zoom to 11×, so close
zoom never thickens the line and hit-testing is untouched.

**Hierarchy.** The globe's edge is the heaviest line on the map — it is the only one
that is not a political claim — and the graticule the lightest, with boundaries
between. Coastline is deliberately *not* a fourth level: telling a coast from an
inland border needs shared-edge topology, and these are independent closed polygons,
so the only way to draw the distinction would be to invent it.

**Islands** get the biggest gain and needed no geometry change. A speck of dark land
on a dark sea was previously outlined in something a shade darker still; it now
carries the pale tone and reads as a shape.

### Flags

A **visualisation mode**, not a theme. The theme decides how the map looks; the mode
decides what it is showing, and both are in force at once. It is mutually exclusive
with the data scales and the comparison, and turning it on *suspends* them rather than
clearing anything — every value, group, side assignment, palette choice and legend
title is still there when it goes off.

**A flag is the `fill` of the country's own `<path>`**, painted through an SVG
`<pattern>`. That one decision is what makes the mode both correct and cheap, and it
replaced a first attempt that positioned a rectangular `<image>` near each country's
centre:

- *Shape.* A paint server is clipped by the geometry it fills, exactly and for free.
  The flag follows the coastline, fills every bay, stops at every border and covers
  every offshore island, because it **is** the country's fill. No mask, no overflow
  onto water, no rectangle. Sampled over 500 ocean points: not one carries flag paint,
  so the brief's 50%-opacity provision for unavoidable overflow never applies — there
  is none to render.
- *Cost.* The overlay added a group, an image and a rect per country — some 717 extra
  nodes on a world map, each image an SVG the browser parsed and rasterised on its own,
  and that was the lag. Patterns add **no rendered elements at all**: the 254 paths
  that were always there take a different `fill`, and each flag is rasterised once as a
  tile and reused.

Everything else keeps working because nothing else changed. Hit-testing, hover,
selection, borders, lakes, the graticule, the minimum-size transforms and the magnifier
all still operate on the same paths — the magnifier shows a magnified, correctly
clipped flag with no special case, because it re-draws the same path with the same fill.

**Fitting the flag to a country is a trade, and the trade is one constant.** A pure
cover fit — scale the artwork until it spans the box, crop the rest — guarantees
coverage but destroys the flag on anything far from 4:3: Russia's framing is 7.8:1, so
covering it cropped away everything but the middle band and the country read as a plain
blue rectangle. A pure contain fit has the opposite failure, leaving most of the
country unpainted. So the flag is allowed to *stretch* toward the country's
proportions, up to `MAX_STRETCH` (3.5), and only what the cap cannot absorb is cropped.
Essentially the whole dataset falls inside the cap, so nearly every country shows its
complete flag; coverage is never at risk, because the drawn box is derived from the
tile and is never smaller than it on either axis.

The box is centred on the country's **centre of area**, not the middle of its bounding
box — for a lopsided country those differ, and when a crop does happen, biasing it
toward the mass keeps the visible part of the flag over the part of the country people
are looking at. It is clamped so placement can shift the flag but never uncover the
country.

**And the box is the country's area core, not its raw extent.** The chain that builds a
cluster admits anything within a dozen degrees, which keeps Corsica with France but
also pulled Madeira — and then, chaining onward, the Azores — into Portugal's framing,
stretching its flag a thousand kilometres into the Atlantic so the mainland saw only
the red half. Every polygon contributes its projected bounds weighted by its projected
area, and the outer 4% of area is trimmed from each end. An island holding one per cent
of a country can no longer move the box; a genuine archipelago, where no piece
dominates, is untouched. Land outside the box is still painted, because the pattern
repeats — this decides where the flag is *framed*, never what is covered.

Measured by counting how many of a flag's dominant colours actually appear on the
country: **18/18 complete at region zoom** (France, Belgium, Romania, the Netherlands,
Italy, Norway, Portugal, Spain, Germany, the UK and more), and 21/25 across a
deliberately awkward world-zoom set — the stragglers being countries only a few pixels
wide at that scale. Russia went from one visible colour to 3/3.

**The flag must be sized to cover the tile explicitly.** `preserveAspectRatio="slice"`
on the `<image>` does *not* work: the referenced flag carries its own `viewBox` and its
own default `meet`, and that inner value wins — so the flag was letterboxed inside the
tile and everything around it left transparent, letting the background show through as
open water. On a compact country the letterbox is invisible; on Russia's 736×94 framing
it was almost the whole country, which is why large elongated countries — Russia, the
USA, Canada, Argentina, Mongolia, Antarctica — rendered as sea while Brazil and China
looked fine. The cover box is now solved arithmetically and the image drawn with
`preserveAspectRatio="none"`, which distorts nothing because the box is already exactly
4:3 and leaves no aspect decision to the nested SVG.

That was found by sampling interior points and asking *what colour is this pixel* —
not, as an earlier audit did, whether it merely differed from the flags-off render. A
country turning into water is a difference too, so the earlier test scored the bug as
a pass.

**Two further things made flags look missing.** Found the same way:

- *The border was eating them.* A stroke is centred on the outline, so half of it lies
  inside the country — and for anything near the border's own width, that is the whole
  country. Hong Kong is 1.3 px across at world zoom against a 0.8 px border: every
  pixel of it came out border-coloured. Seventeen island states measured 0% flag
  coverage for this reason alone, with the flag correctly applied underneath. In flags
  mode the stroke is now painted *under* the fill (`paint-order`), so the flag always
  survives and the boundary keeps its outer edge.
- *A scope filter was withholding them.* Out-of-scope land is still drawn, but it was
  being skipped here — so a map of Europe rendered Algeria's and Türkiye's geography
  with no flag at all. Every country the renderer draws now gets its flag; the muted
  treatment survives as reduced opacity rather than as a blank.

**A microstate's flag has to be its own size, and that needs the artwork declared at
natural size.** Sizing the `<image>` in projected units looks correct and fails
silently once a country is small: Monaco's framing is 0.139 × 0.121 units, and an
`<image>` declared that size renders *nothing at all* — not a wrong colour, not a blur,
zero pixels. Measured on Monaco's own path, the same artwork gives 0 lit pixels declared
in user units and 208,751 declared at 640 × 480 and scaled by a `patternTransform`.

That failure was previously worked around with a 14-unit floor on the tile, and the
floor cost far more than it saved. It does not shrink a tile, it *grows* one, so a
country 0.2 units across was given a flag 14 units wide and showed a seventieth of it —
one flat colour, at every zoom, because the tile lives in projected units and scales
with the map. **Sixty-five of 247 entities showed under a tenth of their flag; the
median country showed 64%.** San Marino, Monaco, Nauru, Macau, Gibraltar and the Vatican
were among those showing none of theirs.

With the artwork declared at natural size the floor drops to a bare degeneracy guard and
the tile is simply the country's own extent. **No entity now shows under half its flag
and the median is 100%**, the remaining crops being genuine aspect-ratio trades on
elongated countries (Russia 60%, Israel 67%, Malawi 79%). Monaco renders 2,847 pixels
across 10 distinct colours where it rendered none; San Marino, 39.

Coverage now measures **4,190 interior points across every country: none rendering as
water, none falling back to land**, and 239 of 239 countries with artwork carrying a
flag fill.

**Maritime territory is real geography, taken from a maritime dataset — and only island
territories get it.** A country's water is its exclusive economic zone, from Marine
Regions' World EEZ — the authoritative source for them — fetched by
`scripts/fetch-eez.mjs` and drawn at half opacity beneath the land.

**Off by default, behind a switch with the mode it belongs to.** "Island Water Coverage"
appears under the Flags control and governs this layer alone: the flags on land and the
separately framed territories are untouched either way. It is a
visibility control and nothing more — the geometry is prepared and cached on the same
inputs regardless, so turning it on and off measures 0 ms of blocking work and only
changes what is drawn.

**Qualification is asked of each zone, not of each country.** That is what tells Hawaii
apart from the country that owns it: the United States holds three zones and only the
Hawaiian one is an island territory. A zone qualifies when the land beside it is under a
twentieth of its area — above that sit the mainlands (Germany's land is six times its
water, Romania's ten, China's eleven, Brazil's twice, Canada's nearly twice, and mainland
France, Spain, Italy and Alaska all hold more than a twentieth of their seas), and below
it sit the island territories (Fiji a seventieth, Hawaii and the Canaries a hundredth,
French Polynesia and Kiribati a thousandth, Tuvalu a thirty-thousandth). **68 territories
of 227 zones qualify.** Germany, Romania, China, Canada, Japan, Indonesia, the
Philippines, the UK, Russia, India, Italy and Poland have none at all, and probing the
coast confirms it: no water off Brittany, Barcelona, Lisbon, New York, Bergen, Rio,
Sydney, Auckland, Rotterdam or Cape Town — but water off Clipperton, the Canaries, the
Azores and Hawaii.

**Land *beside* the zone, not inside it.** An exclusive economic zone is water and its
inner boundary is the coastline, so a country's land lies outside its own zone almost by
definition. Asking what a zone contains returns nothing for everybody, mainlands included,
and would hand every country in the world a sea — which is exactly what the first attempt
did. Adjacency is the question that separates them.

**One territory, one flag.** The water carries a single flag fitted to itself, by the same
routine the land uses — the area core of the geometry, the same bounded stretch, the same
deepest-interior anchor. The land's own pattern cannot be borrowed: it is framed to the
country's islands, and a territory's sea is hundreds of times their size, so it simply
repeats — Palau's water came out as a field of identical yellow discs and Micronesia's as
rows of stars, which is the one-flag-per-island look this exists to avoid. Nothing about
land placement is touched.

**A merged group is one territory too.** Its members' zones are still judged one by one —
Guam by Guam's land, not by the group's — and are then handed to the group and dissolved
into one body carrying the group's flag. A group with no flag has plain land and no flag to
fly over its water, so its members' water is not drawn; before, Guam's and the Marianas'
own flags went on being drawn round islands whose land no longer wore them. Measured with
the two grouped: 72 bodies, 70 with the group unflagged, 71 with it flying the Stars and
Stripes (one body where there were two), and 72 again once the group was deleted.

Nothing about it is derived from where the islands sit. An earlier version buffered the
islands' own geometry and dissolved the result; it was built from real geometry, but
around a lone island a buffer is a disc however it is computed. What replaced it is the actual zone: French Polynesia's
water is the four-lobed shape its island groups earn it, Kiribati's is three separate
zones because the Gilbert, Phoenix and Line groups are three separate places, and the
boundary between two neighbours is the median line the dataset draws, not an arc.

Natural Earth, which supplies everything else here, has no equivalent — it carries
maritime *indicator lines*, bathymetry and named sea regions, none of which is a
country-associated area — so this is the one layer that comes from elsewhere:

**The zones are vendored in `data/maritime/`** and copied into `public/geo/` by
`prepare-data.mjs` like every other dataset. `fetch-eez.mjs` used to write them straight into
`public/geo/`, which git ignores, so the deploy — a clean checkout — never had the file: island
water worked on every machine that had run the fetch and drew nothing on the live site.

>  Flanders Marine Institute (2019). *Maritime Boundaries Geodatabase: Maritime
>  Boundaries and Exclusive Economic Zones (200NM), version 11.*
>  <https://www.marineregions.org/> · <https://doi.org/10.14284/386> · CC BY 4.0

**Three things are decided when the data is fetched rather than when it is drawn.**

*Which zones exist.* Only undisputed 200-nautical-mile zones are kept. The dataset
separates those from `Overlapping claim` and `Joint regime` areas, so dropping the latter
two — 35 and 21 zones — resolves every contested water according to the source instead of
by drawing one country over another. The Falklands are the visible consequence: the
dataset holds them as an overlapping UK/Argentine claim, so they have no zone here.
Measured over an 8,400-point grid: **865 points fall inside exactly one zone and none
inside two.**

*Who owns them.* The zone's own territory where this map draws it, and the sovereign
where it does not. Eighteen zones have no territory code at all — the Azores and Madeira,
Hawaii and Alaska, the Canaries, the Galápagos, the Andamans — and belong to Portugal,
the United States, Spain, Ecuador and India. French Guiana needs the same answer for a
different reason: it holds its own undisputed zone *and* its own flag, but Natural Earth
draws it inside France, so nothing on this map is painted with that flag. The test is
therefore whether an entity is **drawn**, not whether it has a code — asking the looser
question silently lost the zone.

*How much detail survives.* The raw layer is about 354 MB: a 200-mile offset is smooth,
but the coastal half of every zone carries the coastline at full resolution and none of
that is legible here. Douglas–Peucker at 0.04° with coordinates to three decimals brings
it to **1.3 MB across 227 zones**, leaving every shape intact. The raw responses are
cached, so retuning the tolerance costs nothing.

**Land always wins, by drawing order.** The layer sits before every country path, so a
coastline is painted over the water afterwards and no zone can cover anyone's land —
which is also why the few kilometres of coastal precision lost to simplification never
show. 1,292 sampled land points still render as land.

**The geometry does not change with the camera.** Projected once per projection and
carried by the same transform as the land: **184 zones at every zoom from 0.25× to 256×,
with a byte-identical geometry hash at each.** They cannot turn into circles or drop out,
because there is no threshold and no level of detail — only the one real polygon.

**Scattered island countries are drawn at their true size.** A Maldivian atoll is about a
twentieth of a pixel at world zoom, and its flag rasterises to nothing there; it appears as
the camera comes in, like every other island. Islands used to be held at a minimum drawn
size per island, which made them grow as the camera zoomed out — see *No minimum rendered
size*. The island-water layer, drawn from the real zones, is what shows an island nation's
extent at world zoom.

**"Auto" is one fixed projection, not the region's own.** It resolves to Robinson
everywhere, through a single `resolveProjectionId` that both the
renderer and the exporter call so the two can never disagree. Regions still carry a
`projectionId` and still use it for framing — the centre, the standard parallels and the
extent each fits to are untouched — and every projection the author picks by hand behaves
exactly as before.

**Framing.** The flag is stretched across the country's *dominant landmass cluster*,
not its bounding box. France's geometry includes French Guiana and Réunion, so its
bounding box spans two oceans and mainland France would show about eight per cent of
the flag — one solid blue stripe. The largest polygon seeds a cluster and everything
whose coastline comes within 500 km chains onto it: Corsica joins, Guiana does not. Land
outside every framed cluster still gets the flag, since the pattern repeats.

**Clusters are measured coast to coast, not box to box.** Bounding boxes put Alaska
next to Kansas: the panhandle runs far enough south that the two boxes all but touch, so
by boxes the United States is one landmass and one flag is stretched from the Bering Sea
to Florida — the mainland showing a couple of stripes, Alaska a corner of the canton.
Coast to coast they are some 830 km apart. At the 500 km threshold the separations that
matter fall either side cleanly: Sicily (3 km), Crimea across the Kerch Strait (4 km),
Corsica (85 km), Sardinia (190 km) and Tasmania (240 km) stay with their mainlands, while
Alaska, Madeira (900 km), the Canaries (1,100 km), the Azores (1,400 km), Hawaii
(3,800 km) and French Guiana (7,000 km) each stand apart.

Measuring every pair of coastlines is the one expensive step here, so the pairs are
settled by bounding box first — scaled for how longitude narrows towards the poles, a
sound lower bound — and only the few it cannot decide are measured point by point.
Union-find over the pairs replaced repeated passes over a growing cluster, which had
re-measured the same pairs once per pass and once per member, and sampling is scaled to
each landmass rather than fixed, since Canada alone is 410 polygons and nearly all of
them are small. Together: **5.8 s to 0.97 s, computed once per dataset and cached.**

**A detached cluster holding at least a twelfth of the country's land is framed
separately.** Distance is already settled by the time this is asked — a cluster exists
precisely because it is far from everything else — so all that remains is whether it is
substantial enough to be worth its own flag. Alaska (a fifth of the United States) and
French Guiana (a seventh of France) are; the Azores (a fortieth of Portugal) and the
Galápagos (a thirtieth of Ecuador) are not, and go on sharing the mainland's flag
through the repeat. Crimea never reaches the question: it is within the gap of the
Russian mainland, so it is part of that cluster. Ten countries qualify, for 18 extra
placements in all.

Each is drawn on **its own outline**, filled from its own pattern — bounded by the real
coastline exactly as the first is, with no geometry invented to hold it. It carries the
same stroke as the path beneath, which it covers, and no pointer events or country id, so
hit-testing still runs against the single country path and selection is untouched.

**Clipping a territory to a bounding rectangle looked reasonable and was not.** A
rectangle around dispersed geometry covers everything between the pieces, and Alaska is
the case that proves it: the Aleutians cross the antimeridian, so the cluster spans -179°
to +180°, its projected box runs 96 → 779 against a map 1,080 wide, and the Alaska-framed
flag was painted straight across the northern contiguous United States. That is the
malformed band along the top of the mainland. Clipping to the real outline cannot do it —
tested at seven points from Montana to Maine, none falls inside the Alaska overlay, and
Alaska's interior does.

The tile lives in the same projected user space as the paths, so zoom and pan carry
both and recompute nothing; only a projection, dataset, region or viewport change
rebuilds them. Verified: panning leaves the pattern nodes identical.

**Flags mode draws its own border, and it is black.** The data modes choose a tone by
measuring contrast against the fill, because a palette runs from near-white to near-black
and one fixed colour cannot separate both ends. A flag is many colours at once, so there
is nothing to measure — and the job is different: neighbours here are not two steps of
one ramp but two unrelated flags that may share a colour outright, so the line between
them has to read against anything. Black does, and it is the convention for a political
boundary besides. It is drawn at 2.25× the document's border width, so the setting still
means something, and the stroke stays non-scaling so the line holds its weight at every
zoom rather than thickening as the map is magnified. The stroke is painted *under* the
fill, so a country narrower than the line keeps its flag.

**Off by default, behind its own switch.** "International Borders" sits beside "Island
Water Coverage" under the Flags control and governs this layer alone. Switched off the
layer is not rendered — not hidden, not made transparent — so the mode looks exactly as it
did before the treatment existed; rasterised at Europe framing, the before and after
states hash identically. The network is derived and projected either way, so the switch
costs a render and nothing more, and the two flag switches are wholly independent: all
four combinations were measured.

**A layered line where two countries meet, and only there.** Two neighbouring flags can share a colour
outright — Kuwait against Iraq — so the boundary between them carries the whole
separation, and one dark line against two dark flags is not enough. A pale edge either
side of a heavier black core reads against anything: flag | white | black | white | flag.

**It is drawn on the international boundary network, which the dataset already knows.**
Stroking country outlines cannot express this — an outline has no idea which of its edges
is a coast — and comparing coordinates to find shared edges would be inventing the
answer. The dataset is TopoJSON, where a border shared by two neighbours is stored *once*
as one arc that both reference, so "shared" is recorded in the file: `mesh` hands each arc
the two geometries either side, and keeping only those whose sides resolve to different
country ids leaves exactly the international borders. A coastal arc has the same country
on both sides and is dropped. Compared by country id rather than object identity, because
one country can be several geometries — Natural Earth 50m carries Australia as two — and
the seam between two pieces of one country is not an international border.

**The line answers the camera, slowly.** A non-scaling stroke holds a constant screen
width, which is the wrong behaviour here: zooming out shrinks every country while the
line stays put, so a fixed band swamped countries a few pixels across and the world view
was mostly border. Scaling with the map is equally wrong the other way. So the width
follows the zoom at an exponent of 0.3 — a fortyfold magnification thickens it threefold —
clamped at both ends: 0.76px zoomed out to half scale, 1.0px at world zoom, 1.5px
continental, 3.0px on a single country, capped at 3.2.

**Butt caps, not round.** The network has 376 free arc ends, most of them where a border
runs out at the coast, and a round cap puts a half-disc of the pale stroke *past* each
one — a white blob on the coastline and at every junction. Probing just beyond each free
end: with round caps **376 of 376** were covered by pale stroke that should not have been
there; with butt caps 183, and those are ends where another arc genuinely continues the
border. 193 blobs removed, and the pale edge now stops exactly where the border does.

Verified by hit-testing the network itself: France/Germany, the US/Canada 49th parallel,
Portugal/Spain, Poland/Germany, Kuwait/Iraq and Haiti/Dominican Republic all fall on it;
the Atlantic coast of Portugal, Perth, Iceland, Japan, Madagascar and open ocean all fall
off it. **206 arcs, one path pair for the whole world** rather than one per country, so no
seam can appear where two countries' outlines would have overlapped. Coastlines keep
exactly the border they had, and a country meeting only water is untouched.

The maritime layer is deliberately excluded — it keeps its own single black outline and
its half opacity, untouched.

**A fixed line is wrong for a country too small to hold it.** At world zoom a Bahamian
island is about a pixel across while the line is 1.8px and centred on its outline, so the
island is entirely border: measured over its interior, **69% of the Bahamas rendered
black and only 31% showed any flag**, and zooming in uncovered more of it. That is the
other half of the disappearing-flags report — the flags were there all along, painted
over by their own outline. The line is now capped at a fifth of the land it is drawn on,
taken from the country's own geometry (the diagonal below which half its area lies) and
scaled by the zoom. Canada keeps the full weight; the Bahamas get 0.5px at world zoom,
rising to full as you come in. Nothing is hidden by this — only the line over the flag is
limited.

**Artwork** is `flag-icons`, copied verbatim by `scripts/prepare-flags.mjs` into
`public/flags/` and keyed to the app's entity ids through the `iso2` already in the
country table — never by matching names.

**One flag is overridden rather than added.** `flag-icons` ships Honduras in the
turquoise adopted in 2022; the flag returned to navy in 2026, so `assets/flags/hn.svg`
replaces it at `#0d3b99`. Every path, transform and `use` in that file is the library's
own geometry copied verbatim — the three equal bands and the five stars in their
quincunx, at the same coordinates and scale — so only the colour differs and nothing
about framing, fitting or clipping can shift as a result.

Overrides are named explicitly in `prepare-flags.mjs` with their reason, because local
artwork is otherwise only ever *added*: a code the library already carries keeps the
library's file, so nothing shipped here can quietly diverge from the published set by
merely existing. Exactly one of the 252 shipped flags differs from the library, and the
build prints which and why.

**The fifteen entities with no ISO code are decided one at a time**, in
`scripts/territory-flags.mjs`, because guessing either way is wrong. Eight fly a flag:
Somaliland and Northern Cyprus have their own, drawn in `assets/flags/` from geometry
taken verbatim from the library's Turkish and Somali artwork rather than by hand; Akrotiri
and Dhekelia fly the British flag, Guantanamo Bay the American, Clipperton the French, and
the Indian Ocean and Coral Sea territories the Australian. Seven are deliberately left as
plain land with the reason recorded — a UN buffer zone, a contested glacier, reefs and
banks claimed by several governments at once, and Baikonur, where neither flag is the
plain answer. 252 codes now ship, and the generated manifest is consulted before any
request, so an entity without artwork falls back to plain land rather than 404-ing.

Somaliland's shahada is set as text rather than traced: it needs Arabic glyph outlines,
which cannot be reproduced faithfully by hand, so it is left to the system's Arabic face
and renders plain where none exists. At every zoom this map reaches it is well under a
pixel.

**Turning the mode on used to take about ten seconds, and it took them on every toggle.**
Profiling put the cost in four places, and three of them were doing work twice or for
nothing.

*The deepest-interior anchor ran for every country and mattered to fourteen.* It is only
consulted when the flag is cropped, and where the artwork fits the tile the clamp pins it
to the corner whatever the anchor says. At about 108,000 distance tests per country, 240
countries were paying for a result that was discarded — **six seconds**.

*The world was measured four times over.* Framing measures a country's cluster, the border
rule measures its land, and the island floor (since removed) measured it again to pick
candidates and again to find neighbours; each full pass of `path.bounds` and `path.area` over 4,252
polygons costs 1.3 seconds. They can share, because `flagPlacement.ts` puts the feature's
own coordinate arrays into its clusters rather than copying them, so a cluster's polygon
is reference-identical to the country's — a `WeakMap` keyed on the array, and on the
projection, collapses the four passes into one.

*The island floor (since removed) built a neighbour table for the whole planet.* It projected ring points
for all 4,252 polygons when almost none is within reach of a scattered archipelago.
Gathering the candidates first bounds the table to what could actually affect an answer:
**3.2 s to 0.45 s**.

*And the toggle threw the results away.* Gating the geometry on the mode itself meant
turning it off replaced every input with null, so turning it back on presented React with
changed dependencies and rebuilt everything — the full cost paid on each toggle rather
than once. The preparation is now latched on first use and never cleared, so a toggle
after the first does no geometric work at all.

What remains that is genuinely one-time — clustering every coastline, which is decided by
the dataset alone and is the same for every projection, zoom and region — is warmed while
the browser is idle, so it is never on the critical path of a click.

Measured end to end, as blocking time on the main thread: **987 ms the first time the mode
is opened, 0 ms to close it, and 184–271 ms to reopen it** — from about ten seconds, every
time, with byte-identical output: the same 247 tiles, 248 floored islands (a layer since removed), 68 maritime
territories and the same placement hash across four toggle cycles.

**Compare owns its groups.** The mode used to borrow the document's `MapGroup`
collection and colour it through an A/B side map, which meant three places to visit
before a comparison existed: build a group in one panel, name it, then map it onto a
side in another. Neither panel said what the other was for, and "A" and "B" were the
only vocabulary on offer.

Compare now holds its own groups — a colour, a name, a set of countries — in
`doc.comparison`, and the whole workflow is in the Compare panel: choose how many groups
(1–4), click one, select countries on the map, add them. The active group is named in
the action itself, so "where is this going?" is answered by the button about to be
pressed. The standalone Groups section is gone from the sidebar.

`MapGroup` is untouched and still in the model — it carries values a data scale can read,
which a comparison group deliberately does not — but nothing about comparing depends on
it any more.

**Four groups are always stored; `groupCount` decides how many are in play.** Dropping
from four to two therefore destroys nothing: the other two keep their colours and members
and come back if the count goes up. Only the first `groupCount` are drawn, listed, or
read by the legend, and where a country sits in more than one the first wins — the same
precedence the side-based model used.

A group's name is edited in place: double-click it and the label becomes an input the
same size, so the panel does not resize while a name is being typed. Enter and moving
focus away save it, Escape restores it. The name is written once, on commit, rather than
on each keystroke — so a rename is one operation and one undo step however long the name
— and because everything that shows a group reads `group.name`, the legend and the
colour control's label follow with no wiring of their own.

**In Compare mode the inspector stops at its first line.** Everything below it edits
values, and comparison reads no values at all — it colours by membership — so a card per
selected country was a column of controls that did nothing for the mode in use. Worse, it
grew with the selection: twenty countries meant twenty cards above the Compare panel,
pushing it off the top of the sidebar exactly when the author was using it. Selecting
twenty now leaves **zero** cards and the panel where it was, and where those countries are
going is answered by Compare, in the group they are about to join. Data mode is untouched
and keeps the full inspector.

Each group shows its own membership underneath it, as codes and nothing else — a readout
rather than a second way to pick countries, since the map already does that. No names, no
regions, no values, no control per row, and the codes wrap, so a group of twelve costs two
lines rather than twelve. The order inside a group is the group, its members, then its actions. Only the
active group carries the actions; four copies of the same pair would be noise.

Assignment carries the whole selection in one operation, so adding twelve countries is
one undo step rather than twelve; colour changes coalesce per group, so dragging a picker
is one step rather than one per frame. Selection itself is untouched — the panel only
reads what the map has selected and writes it into a group.

**Export** needed no new code. Each pattern holds a `data:` URI of the library's real
SVG — not an optimisation but a requirement, since an SVG rendered inside an `<img>`,
which is how the exporter rasterises, may not fetch anything. The SVG export carries
genuine vector flags and the raster exports rasterise them at their own resolution.

#### World domination

One country's flag over the whole world instead of each country's own — a switch in the
Flags controls and a country picked by typing its name.

The implementation is **one pattern, not 250**. Painting the same flag into a
per-country pattern each would repeat the design 250 times, every country showing its
own complete little flag; that reads as a map *of* a flag rather than as a world wearing
one. A single pattern framed to the extent of everything the mode draws makes the design
run *across* the borders — each country shows whichever part of the flag it sits on, and
the planet reads as one covered surface. It also loads one image instead of 250.

The box is taken from the flag tiles rather than from the sphere, so it follows the
region actually on the map: a map of Europe gets a flag framed to Europe rather than a
crop of one framed to a globe that is mostly off screen. Being in the same projected user
space as the country paths, the camera transform carries it — the pattern is byte-for-byte
identical before and after a zoom, so panning and zooming recompute nothing and the flag
stays pinned to the geography. Verified across Robinson, Winkel Tripel, Nell–Hammer,
Mercator, Equal Earth, azimuthal equal-area and Albers: one pattern over all 247
countries in each, at a true 4:3 image aspect, so the artwork is cropped to cover rather
than stretched — the same policy the per-country patterns follow.

The **territory layer is not drawn** while this is on. It exists to give a detached
territory its own framing of its country's flag, and with one flag already spanning the
world, Alaska is covered by the same continuous design as the rest of the country; a
second copy framed to Alaska alone is exactly the repetition the single pattern avoids.
The maritime layer *is* kept, painted from the same override, so island water keeps
working.

It is an **override, not an edit**. The footprints, tiles and territories
are built exactly as they always are and are not consulted about it, so the switch
changes only which paint server the shapes point at. Turning it off restored all 247
per-country fills with zero differences from before it was turned on, and brought the 18
territory placements back; the chosen country is remembered, so flicking it back on
returns to the same flag rather than an empty field.

Export carries it for the same reason everything else does — the exporter copies the
SVG. Measured: the world pattern present, **zero** per-country patterns, 506 references
to it, and a rasterised result with 45k red and 51k white pixels for the Japanese flag.

#### Changing an entity's flag

Select an entity in Flags mode and the inspector gains a **Change Flag** picker: type a
flag's name and choose any flag in the library, whatever the selection's own nationality.
It works for a country, a territory, a region of the administrative map and a merged group,
and for a whole selection at once, as one undo step. Pick Japan while Romania is selected
and Romania flies the Japanese flag; Japan, France and everyone else keep their own.

The flags offered are **one list**, `flagOptions` in `src/flags/flagChoices.ts`, which the
Merge panel and the overlays use too:

- every entity's own flag;
- the flags only the territory list knows (Somaliland, Northern Cyprus);
- the country of each region;
- the historical set.

That third source is what gives a map of provinces every country's flag to choose from,
although none of its own units carries a flag.

**Where the choice is stored:**

- A country, a territory or a region gets an entry in `flags.overrides`, naming the artwork.
  `flagCodeFor` resolves it as it resolves every other flag. Entries from earlier maps that
  name a country rather than artwork still resolve as before.
- A merged group's flag is its own `flag` field, the one its row in Merge sets. So the two
  panels change the same thing and cannot disagree.

**Default and custom are told apart.** The inspector says **Default flag: France**, or
**Custom flag: Italy. Its default is France.**, or that the entity has no flag of its own yet.
**Use default flag** deletes the entry rather than writing a default back, so a reset country
is indistinguishable from one that was never changed; for a merged group it clears the
group's flag. An entity nobody has changed flies exactly what it always did. The regions of
the administrative map still show plain land until a flag is chosen for them.

Resolution happens in **one place**: `entityFlagCode`, which `MapCanvas`'s `flagCodeOf`
calls and the panels share. `buildFlagTiles` is handed it instead of a bare `flagCodeFor`,
and everything downstream follows:

- the maritime codes derive from the tiles, so an island territory's water flies the flag
  its land does;
- exports, labels, selection and the overlays see the same flag.

Nothing is written to the flag data: `geo.meta.ROU.iso2` is still `RO` with an override in
force.

**World Domination is untouched.** It replaces the *paint* downstream of tile
construction, so an override survives underneath it: switch domination on and Romania
shows the world pattern like everywhere else, the override still sitting in the
document; switch it off and Romania is flying Japan's flag again. Neither feature knows
about the other.

The picker applies to the whole selection, so changing six countries at once is one
gesture and one undo step — the same treatment every other multi-selection edit gets in
this editor.

Measured: distinct pattern hrefs before and after; the ten other countries checked
still on their own flags; unchanged under Winkel Tripel, Mercator and Nell–Hammer, at
low, medium and high dataset resolution, and at 4× zoom with the map panned; and the
borrowed flag present in the serialized SVG export.

### Data values on the map

**Display → Labels & Helpers → Data Values** prints each entity's value on the map, where its name
goes. It is independent of **Region Names**: names, values, both or neither. With both on, the value
is a line of its own under the name ("France / $44,408"); with names off, it stands where the name
would. An entity with no value in the active layer gets no value — and, with names off, no label.
It is kept apart from the legend: the legend explains the scale, this prints each value. One
switch, in that one place; the setting is `labels.values` on the document, so it is undoable and
travels with the map.

**Placed by the names' own layout.** A label is a name and, optionally, lines under it
(`LABEL_LINE_BREAK` in `render/labelPlacement.ts`), and the whole block goes through the same
fitting as a name: position inside the territory, collision repair against its neighbours, an
outside caption for a speck, and the zoom at which it is worth drawing. So values stay on their
land while zooming, panning and changing projection, and are in every PNG, JPG and SVG export,
exactly as names are. They share the names' face, colour, outline and size controls, which appear
whenever either switch is on.

**A value never changes its name.** The name's size, its wrapping and whether it fits inside are
decided from the name alone, exactly as before values existed; the value line only widens and
deepens the block, which is what neighbours keep clear of. Measured with every country on the World
map given a value — the most crowded case — no name was lost at 1×, 2× or 4× (two more fitted at
world zoom), and the only difference was five long names wrapped at a different point where a
neighbour's value needed the room ("Central African / Republic").

**Formatting** is `formatDataValue` in `state/legend.ts`: grouped thousands below a million
("45,200"), compact above it ("1.2M", "$2.9T"), up to four significant figures below a thousand
("0.7341"), and text values as they are. The unit is the active scale's — the layer's own `unit`,
or the fixed preset's when Predefined is the scale in use — placed where it is read: a currency
symbol before the number ("$45,200"), anything else after it ("42%", "78.2 years").

### Compare group values on the map

**Display → Labels & Helpers → Compare Group Values** prints each Compare group's value on every
country or region in that group: a group holding France, Germany, Italy and Spain with the value 50
puts "50" on all four. Its own switch, independent of **Region Names** and **Data Values** — any of
the three, or none — and nothing to do with Merge Groups.

The value is set on the group itself: under the active group in **Styles & Data → Compare**, a
**Group value** field, written on Enter or when the field is left, as one undo step. A number is
stored as a number ("50", "1,200"), anything else as the text typed ("High"), and an empty field
removes it; each group's value is shown in its row beside the member count. It is `value` on the
group (`ComparisonGroup.value`), optional and only ever displayed — Compare still colours by the
group's colour and reads no values, so a comparison with no values is exactly what it was.

A country in no group shows no group value, and a group with no value shows nothing on its
members. A country in two groups shows the first group's value — the same first-group-wins rule
that decides its colour — so it never wears one group's colour and another's value.

The value is a line of the label, like a data value: under the name, and under the data value when
that is on too ("France / $44,408 / 50"); on its own with the others off. So it is placed, sized,
de-conflicted, held back at a zoom where it would be unreadable, carried by the camera and
exported exactly as names are. Measured on twelve European members of one group: from 2× every
member shows the value in every combination of switches; at world zoom six of the twelve do —
where names alone show three — because Belgium or Switzerland are a few pixels wide there, and the
names' readability rule holds text back rather than print it too small to read.

### Legend

Drawn **inside the map's `<svg>`**, in screen space, outside the zoomed group. That is
the load-bearing decision. An HTML overlay would be easier to position and would be
missing from every PNG, JPG and SVG, because the exporter copies the SVG and nothing
else; living in the SVG means the legend is captured exactly where it appears at no
cost to the export at all. Being *outside* the zoomed group is the other half: the
legend is a caption on the map rather than a feature of it, so panning and zooming
move the geography underneath and leave the caption alone.

**Position is a fraction of the room the legend has to move in**, not of the viewport
and never in pixels. `0` is flush against one margin and `1` against the other, so a
legend in the bottom-right is at (1, 1) and is still in the corner at any window size
— a viewport fraction would push it off the edge as the window shrank. 0.5 is the
exact centre, which is what the centre snap writes.

**Snapping** offers three targets per axis — both edges and the centre — which between
them give the four corners, the two centred edges and dead centre, and the axes snap
independently, so "centred horizontally, at the top" is expressible where a
corners-only rule could not. Outside 14px the legend goes exactly where the pointer
puts it. A centre snap draws a dashed guide down or across the viewport while it
holds.

**One drag is one undo step.** The gesture runs on local component state and commits a
single `set_legend` on release; dispatching per `pointermove` would put a hundred
entries on the stack for one gesture.

d3-zoom is told to ignore gestures that begin on the legend, through its own `.filter`
rather than by stopping propagation — d3 listens natively on the `<svg>` while React's
handlers are delegated from the root, so a React `stopPropagation` would run after the
pan had already started. The canvas also declines to resolve a country under the
legend, since the assist catchments would otherwise let a click on it select whichever
microstate it happens to cover.

**Content follows the active mode**, derived by `buildLegendModel` from the same
precedence `resolveDataFill` uses, so the two cannot disagree: a ramp with min/max
labels for sequential palettes (the diverging ramp also labels its midpoint, since it
is dark at both ends and the colours alone do not say which way is up), the real
threshold ranges as a *list* for predefined mode, and the two sides with their group
names for Compare. When the active mode has nothing to explain — colouring off, or a
numeric scale with no values yet — there is no legend.

Colours come from `legendSurface` and `legendText` map tokens rather than CSS
variables, for the same reason the legend lives in the SVG: a stylesheet does not
travel with an exported file.

**The title is free text with a shortcut list beside it**, and the field is the
authority. Picking from `TITLE_PRESETS` writes that text into the title and stops
there — no mode is entered, no flag is stored, nothing reads the list back, so
"GDP per Capita" becomes "GDP per Capita (USD)" by typing or gets replaced outright
by "Economic Output per Person". The selector shows *Custom* by deriving whether the
title happens to match a preset, rather than tracking it: a stored "is custom" flag
would be a second opinion about the same fact, and the two would drift.

An empty title is not a missing one — it means "describe yourself", and the legend
falls back to the active mode's own name (the layer, the threshold preset, or
"Comparison"). That fallback is the field's placeholder, so the author can see what
they are about to override. Nothing ever writes back over a title they typed;
switching Data → Predefined → Compare leaves it untouched.

A **subtitle** is a separate field for the unit or qualifier — "people per km², 2024".
Its own field rather than something appended to the title, because the two are
different sentences and the legend sets them differently: small caps at full strength
above, sentence case dimmed below. The panel grows by one line only when there is one.

Both dispatch per keystroke, like the map-name field in the header, so the legend
updates as it is typed; `coalesceKey` gives every `set_legend` the same key, so an
18-character title is **one** history entry rather than eighteen.

#### The content is the layout

The legend is one component, not a box with something drawn in the corner of it. The
panel's size is an **input to the layout**, and `layoutLegend`
(`src/state/legendLayout.ts`) solves everything inside against it: type sizes, the
palette bar, the swatches, the spacing and where the text wraps.

The scale is **solved by bisection, not stepped down from 1** — the largest size at
which the content still fits the height it has been given. That is the whole difference
between this and a fitting pass. A panel dragged larger reports a larger scale, so the
ramp, the swatches, the type and the spacing all grow together; dragged smaller, the
content reflows to meet it. Width participates by changing where the text wraps, which
changes the height at every candidate, so widening a legend really does let the content
grow rather than only stretching the box. Measured on a three-group Compare legend:
dragging 186×97 → 460×420 takes the swatches from 9px to 49.5px and the labels from
9.5px to 22.8px. On a ramp, the bar goes from 11px to 176px tall and its steps from
28px to 72px wide, always spanning the full inner width.

This is deliberately **not a transform**. A `scale()` on the group would multiply the
stroke widths, blur the type off the pixel grid and — worst — freeze the line breaks
computed at the old size, so a wider legend would show the same ragged column with
empty space beside it. Here the sizes are real numbers in real attributes and the text
is re-wrapped at every candidate.

Whatever the scale ceiling leaves over is **distributed, not left at the bottom**: a
taller palette bar, roomier rows, more air between blocks. The gap share is divided by
how many gaps there actually are — assuming a fixed number left the share of a gap that
did not exist unspent, which landed at the foot of the panel as exactly the dead space
the distribution exists to prevent.

Text is measured with a canvas `measureText`, never estimated from character counts,
because the wrap has to agree exactly with what the browser will draw and the same
measurement has to hold for the exported copy.

#### Elements, and their sizes

Five: the title, the subtitle, a free line of **text**, an **icon**, and the body the
active mode derives. The free line is its own element rather than something appended to
the subtitle because it is a different kind of statement — the subtitle qualifies what
is being measured, the free line credits or annotates it ("Source: World Bank"). The
icon is a small mark beside the title, drawn from a finite set of paths in
`src/state/legendIcons.ts` rather than an icon font or sprite sheet, because the legend
lives in the SVG so the exporter captures it, and geometry is what survives
serialisation.

Plus a fifth multiplier with no field above it: **items**, covering the legend's
entries — the swatches and the labels beside them in a row legend, the colour bar and
its end labels on a ramp. One control rather than two, because a colour and the words
beside it are one entry; sizing them apart makes a legend whose colours and labels
disagree about how important they are.

Each carries a **size multiplier** rather than a point size, because the layout already
solves a scale of its own: a multiplier rides on top, so "title a bit bigger" stays true
at every panel size. 1 is whatever the current style asks for, so every style keeps its
own proportions until the author says otherwise.

The subtle part: **the solve runs against neutral multipliers, and the author's are
applied afterwards.** If the multipliers fed the solve, the solve would cancel them —
asking for a 250% title makes the content taller, the fit answers by lowering the scale
in almost the same proportion, and the title comes out the size it already was while
everything around it quietly shrinks. The control would appear broken and would in fact
be doing the opposite of what it says. Solving against neutral sizes asks a question the
multipliers cannot distort ("how big is this panel relative to the style's own
proportions") and leaves them meaning exactly what they say.

If the multipliers then overrun the panel, the whole layout is **damped by one common
factor** before anything is given up. That preserves the ratios the author set — a 2.5×
subtitle stays two and a half times the title — while the absolute sizes come back
inside the box. The alternative, letting the degradation drop whatever no longer fits,
would answer "make the subtitle bigger" by removing the subtitle, which is the least
useful reading of the request available.

The item multiplier needs one more guard, for the same reason and in a different place.
Slack is what is *left over* after the body, so it moves opposite to it: ask for smaller
entries and the leftover grows and hands it straight back, ask for larger ones and there
is none left to give. Distributed naively that does not merely weaken the control, it
inverts it — the colour bar measured **shorter** at 250% than at 50%. So the slack is
computed against the body at its neutral item size and the multiplier applied on top,
and growth past that baseline comes out of the spacing, which is the compressible part
of the panel. The bar and its end labels are then clamped *together*, in proportion:
clamping only the bar let the labels claim the room first and drove the same inversion.
The result is monotonic — on a fixed 320×230 panel, 50% → 250% takes a ramp bar from
37.9px to 99.3px and a compare swatch from 11.7px to 30.3px, with every entry still
drawn. On an auto-sized panel there is no ceiling at all: the panel grows with the
entries.

Only past that floor does the header give up lines, and in a deliberate order: the free
line first, then the subtitle, then title lines from the bottom with the last survivor
ellipsised at a word boundary. The body keeps its room throughout — a ramp or a band
list is what the legend exists to explain, and losing a row of it to fit a subtitle is
the wrong trade in every case.

The panel is clipped regardless. That is the guarantee: whatever the author types and
whatever the multipliers are set to, nothing paints outside the legend's own bounds.
Measured with all four multipliers at 2.5×: 0 legend pixels outside the panel across
18,304 sampled points.

#### One size, two ways to set it

`legend.size` is `null` until the author sets one, meaning "whatever the content needs";
`naturalLegendSize` answers that by measuring at scale 1. It is the **only** record of
how big the legend is, which is what keeps the corner drag and the width/height controls
in agreement — two ways of stating a size, one place it is stored. Drag the corner and
the controls move; move the controls and the legend resizes. While the size is still
null the controls report the size the legend has actually taken, so a slider starts from
where the legend is instead of jumping.

The corner gesture is anchored at the **bottom-left**: width grows right, height grows
up, so the corner not being held does not move. The origin is recomputed during the drag
rather than left to the anchor, because the anchor resolves *against* the size — changing
one without the other would slide the panel. Clamped to `LEGEND_MIN_SIZE` (120×52) and
`LEGEND_MAX_SIZE` (460×420).

Like the drag, **one resize gesture is one undo step**: it runs on local state and
commits a single `set_legend` carrying the new size and re-derived anchor on release.
`sizes` merges rather than replacing when applied, so a patch naming one element does
not have to restate the other three — and the validator checks only the keys present,
or it would reject every real edit.

The layout is memoised on the identity of its inputs. It solves twice by bisection and
re-wraps every string at each candidate, which costs ~2.5ms — cheap for an edit, but the
legend re-renders with the rest of the map, and paying it per frame of a pan would spend
an eighth of the frame budget recomputing an unchanged answer. Identity is sound because
the document is replaced rather than mutated, so a pan is a pointer comparison (~0.005ms)
and any real edit misses by construction.

#### Where the controls live

All of it sits behind a **Legend settings** disclosure inside the Data & Palette panel,
next to the mode that produces the legend rather than in a section of its own — the
title describes whatever is currently colouring the map. Folded by default: it is the
largest group in the panel and the least often reached for, since the wording and size
of a legend are set once and then left, while the mode and the palette above them are
where an author actually works. Collapsed, it costs one row.

Open/closed is local component state and deliberately nothing more. In the document it
would make "I collapsed a section" an undoable edit, would travel with a saved map, and
would mean two people opening the same file disagree about its contents because one of
them folded a panel shut.

#### Styles are tokens, not components

A legend style is an entry in `LEGEND_STYLES` (`src/state/legendStyles.ts`): padding,
type sizes and weights, swatch and ramp metrics, surface fill and radius, and optionally
a decoration. `MapLegend` reads those numbers and draws **one** legend; `LegendBody`
contains no measuring or fitting of its own, only positions the layout already solved.
Adding a fifth style is adding a record to that map — not another component with its own
copy of the layout, the text fitting, the clipping, the resize handling and the export
path, four of which would then drift apart.

Four ship: **Classic** (the previous legend's own numbers), **Modern** (roomier, rounded,
sentence case, circular swatches), **Minimal** (barely-there surface, no border), and
**Historical** (parchment and sepia ink).

Colours come in two forms. `null` means "take the document's own legend palette", which
is how Classic stays correct under every theme; a literal means the style is a deliberate
look — Historical's parchment is the point of it and must not follow the map's dark
theme. `resolveLegendPaint` collapses the two.

The swatch is a **proportion of the row**, not a size of its own: Modern's swatch is half
its row height and stays half of it at every size, so each style keeps its look as the
legend grows, and the swatch grows with the slack the rows absorbed rather than staying a
chip in an empty band.

**Historical's serpent is drawn to the panel, not placed on it.** Every coordinate
derives from the current width and height, so a resize re-draws the creature instead of
stretching it, and it runs along the edges the content leaves clear. It renders before
the body and is clipped to the surface, so it can never cross a word.

#### Exporting the legend

The exporter copies the live SVG, so every one of these settings carries into PNG, JPG
and SVG for free — verified across all four styles at a custom size with every element
present: the on-screen and exported text counts match, and the icon and free line both
appear in the markup.

The one thing that must *not* carry is the editing chrome. The corner mark and its 16×16
hit area carry `data-export="none"` and are dropped from the clone — an invitation to
edit is not part of the picture. That removal runs *after* the paint-inlining walk, which
pairs the live and cloned trees by index; removing a node before it would shift every
later node onto the wrong partner.

### Merge

Collecting countries into a group, and then dissolving them into one custom entity — an
"Iberia", a "Scandinavia" — with its own name and its own flag. Collecting and dissolving are
two separate steps: a group changes nothing on the map until it is merged.

The operation is `topojson.merge`, and choosing it is the whole design. In TopoJSON a
border between two neighbours is stored **once**, as a single arc both countries
reference; merging keeps the arcs that appear once and drops the ones that appear twice,
which leaves exactly the outline of the union. That is an exact, combinatorial answer
rather than a numerical one:

- the shared border disappears because it was one object and it is gone — not because
  two nearly-identical lines were reconciled to some tolerance;
- no slivers or hairlines appear along the seam, which is what floating-point polygon
  clipping produces where two outlines were meant to coincide;
- islands and exclaves survive untouched, since a ring sharing no arc is carried through;
- countries that do not touch stay separate rings of one MultiPolygon — one entity, still
  geographically honest, with nothing invented to connect them.

Measured on France + Spain + Portugal at 10m: **8,831 vertices before, 7,302 after**, and
60 rings down to 58 — the shared borders genuinely removed rather than painted over.
Indonesia + Malaysia loses exactly two rings, which is their Borneo land border, while
every island survives. Japan + Chile keeps its ring count: nothing was joined.

Nothing here approximates — no bounding box, hull or buffer — and nothing is destructive.
A merge records **which countries** it dissolves, never a copy of their geometry, so the
source dataset is untouched and deleting one restores them exactly: verified back to 254
country paths. Not storing the geometry is also what keeps a merge correct across
resolutions rather than pinned to the one it was created in — the same merge re-derives
from 110m, 50m and 10m topology on its own.

The result is an ordinary MultiPolygon, so it goes through the existing projection
pipeline and every projection, zoom and export handles it exactly as it handles a
country. Its flag is fitted by the same `fitFlag` a country's is, so a merged body gets
the mode's real framing and cover policy rather than a second flag system beside it.

The dissolve is cached on dataset plus membership and runs when a group's members change,
never on a selection change: it walks every arc of every member, which is exactly the kind of
work that must not happen on a pointer move.

**No border is left inside a group.** The dissolve takes the members' shared borders out of
the group's own outline, but the map also draws a border network of its own — the national
lines while coastlines are off, the international borders of Flags mode, the country
outlines over the administrative map — and that network is a mesh of every arc between two
different entities. Two members of one group were two different entities to it, so it drew
the Franco-German border straight back across a France + Germany group. `bordersWithout`
now takes the grouping as well and leaves out an arc whose two sides are in the same group,
while the arcs a group shares with its neighbours stay. Measured along the Rhine with the
two grouped, the nearest line drawn moved from 0.004 px (the border itself) to 1.254 px away;
on the administrative map a Budjak + Odesa group loses the estuary line the same way.

**A merge is an entity, not a drawing.** It has an id, and everything downstream takes an
id — so rather than special-casing merges through the selection, fill, data and legend
systems, they were given what those systems already consume:

- the merged path carries `data-country-id`, which is what the picker resolves, so
  clicking any part of a multi-polygon body selects the entity;
- a member resolves to the entity that absorbed it, because a member is no longer a thing
  on the map and the small-country catchments would otherwise reach across a merged body
  — a click near Andorra was selecting Spain out from under an Iberia that had swallowed
  it;
- paint goes through the same `resolveCountryFill` and `resolveBorderInk` a country uses,
  with the merge's own entry in `doc.countries`, so the palette, the threshold bands, the
  hover and the selection highlight simply apply rather than being reimplemented;
- the executor's known-entity set is the dataset's countries **plus the document's
  merges**. That check exists to catch a *stale* id, not to insist an entity be in Natural
  Earth, and leaving merges out of it was what stopped a merged body from holding a value
  at all: `set_country_value` was refused as an unknown country.

The consequence is that anything added to those pipelines later reaches merges without
knowing they exist. Verified: a merge holds its own value (80 and 20 on two entities),
takes its own palette colour, moves the legend's domain to 20–80, colours under
thresholds, and hit-tests correctly across six projections, three dataset resolutions and
2.6x zoom.

The inspector shows a merge's own identity — its name, a `MERGED` tag and "Made from:
ESP, PRT" — rather than a region for it. It is not a real-world country, and giving it a
subregion would be stating something false.

**A group is a container; merging it is a separate act.** Three buttons, in whichever order
suits the work:

1. **New group** makes an empty group. It needs no selection, merges nothing, and can be
   pressed at any point — before anything is chosen, with a selection already made, or while
   another group is being filled. The new group becomes the one being edited, which is the one
   marked `EDITING`, so there is never a question of where the next Add goes.
2. **Add to group** puts everything currently selected into that group. Nothing goes in on its
   own: a group made while three countries were selected starts empty, and those three go in
   when the button is pressed. It says how many will go in — `Add to group (3)` — and is
   disabled when the answer is none.
3. **Merge** draws the group's members as one entity, dissolving the borders between them. It
   is enabled from two members up, and is the *only* thing that changes the map: until it is
   pressed the members are drawn as themselves, with every border between them, and the group
   is a list in the panel. A merged group is marked `MERGED`.

So `select → New group → Add to group → Merge`, or `New group → select → Add to group →
Merge`. Both are the same three presses and neither does anything that was not pressed.

**The map selects, as it does everywhere else.** Taps, the rectangle and the brush build an
ordinary selection whether the Merge panel is open or not, and the Inspector shows it as
usual. This is what was wrong before: opening the panel turned every tap into "add to the
group being edited", the first tap made a group if none existed, and a group *was* a merge
from the moment it existed — so a stray tap edited a map entity, a selection could not be
gathered and looked at before committing it, and there was no way to hold a group of one.
The panel now reads the selection and waits to be told what to do with it.

Groups are listed in the order they were made, the first at the top, and are never reordered —
by editing, adding, merging, rerendering or switching maps. Choosing a group's row starts
editing it and nothing else: it creates no group, and it leaves the selection alone. × beside a
group deletes it and gives its members back; × beside a member takes that one out. An entity
belongs to one group at most, and a group is never a member of another — the panel's button
counts only what can actually go in, and the document enforces the same rule, so a duplicate
cannot arrive by any route. A group is edited in place — it keeps its id, its place in the
list, its name, flag and value — and each change is one step of the map's undo.

Undo and redo are the map's own, in the header and on Ctrl+Z / Ctrl+Y, as they are for every
other edit. The Merge tool has no history of its own: the **History** section that used to sit
beside it in Edit was a second pair of buttons over the same store history, reading as though
merges were undone separately from everything else.

**Renaming a merge costs nothing.** It used to cost everything. The document is
immutable, so typing one character into a merged entity's name replaced `doc.merges`,
and every memo keyed on that array recomputed: the topological dissolve, a `geoPath`
over the result, `fitFlag` for its artwork, and — because the member set feeds the
filter that decides which countries are drawn on their own — a reprojection of all 245
country paths. Per keystroke.

The fix is to key those memos on what they actually read. A merged entity has two kinds
of field: its **members** decide its geometry, its **flag** decides its paint, and its
**name** decides neither — nothing on the canvas draws it. `useKeyed` holds a value's
reference steady while a key describing only the relevant fields is unchanged, so
`mergeGeometry` and `mergePaint` are two views of the same array that a rename does not
disturb. The name still updates, because the inspector and the Merge panel read it from
the document directly.

Verified across a 31-character rename: the merged body's path data and every country's
path data came back **identical strings**, and the DOM nodes were never replaced. A
straight-at-the-store rename now measures a median of 0ms per character.

The input is debounced on top of that, and for a different reason: even with nothing to
recompute, committing per keystroke still re-renders a tree with 245 country paths in
it. The field holds its own draft and commits after 250ms of quiet, or on blur.
Measured: **0.2ms median per keystroke**, 0.5ms worst, and the document did not move
once while a 23-character name was typed. Undo is unaffected — `update_merge` already
coalesces per merge id, so a name typed in one go is a single step whether it arrives as
twenty-three operations or two.


**Historical flags.** Thirteen additions — Roman Empire, Yugoslavia, Soviet Union, Qing
Dynasty, British Empire, Scotland, Wales, Northern Ireland, Moldavia, Transylvania,
Austrian Empire, Russian Empire, Austria-Hungary — because the point of naming a merged
entity is usually that it corresponds to something historical. Every file is the Wikimedia
Commons asset named in `scripts/historical-flags.mjs`, stored verbatim; none is drawn by
hand, since a flag is a historical artefact and an invented one is misinformation with a
nice gradient. Codes are prefixed `x-` so they can never collide with an ISO alpha-2 code.

The Roman Empire entry is `Flag_of_Roman_Empire-Rectangular.svg`, chosen over the
vexilloid that was there first: the vexilloid is the eagle standard, which is 30%
transparent field above the banner and reads as a white blot when it is painted across
a country. The rectangular flag rasterises **85.8% red, 11.4% gold, 0% transparent, 0%
white** — a flag rather than a standard, and flag-shaped at 1.41:1 rather than nearly
square.
The country loop in `prepare-flags.mjs` is driven by the dataset and would never copy a
flag no country flies, so these are emitted separately and published as `FLAG_EXTRAS`
with the names the chooser searches on.

### Map Overlays

A movable copy of an entity's shape, for comparing one place with another: Texas laid over
France, Greenland dragged to the equator, a historical territory over its modern successor.
The **Map Overlays** section of the sidebar makes them. Select a country, region, territory or
merged group on the map, press **Create overlay**, and drag the overlay anywhere. What was
copied leaves the selection and the new overlay is the one being edited, so it can be dragged at
once and the original is not left painted in the selection colour under it. Only the selection
changes, as part of the same edit: one undo takes the overlay away and gives the selection back.
Every overlay is listed in the order it was made. Choosing one, from the list or by tapping it,
opens its controls:

- mode, **Shape** or **Projection-aware**;
- colour;
- opacity;
- texture: hatching, dots, **Flag** or none;
- **Reset position**, which puts it back over the entity it copies;
- **Move over**, which centres it on the entity selected last;
- **Delete overlay**.

**Flag texture.** Choosing **Flag** fills the overlay with a flag instead of its tint.

- **Which flag.** The flag the entity flies at that moment: its custom flag, a merged group's
  own, or its default. If it flies none (a region of the administrative map, or a group with
  no flag yet), the flag picker opens so any flag can be chosen.
- **It then belongs to the overlay** (`MapOverlay.flag`) and changes only from the overlay's own
  picker. Changing the entity's flag later leaves the overlay's alone.
- **Framing.** The flag is framed exactly as the map frames the entity's own flag: over its
  dominant landmass, with each detached territory that earns one (French Guiana, Alaska) framed
  on its own. Framed over all its land at once, France showed a single stripe.
- **Placement.** The flag sits in the overlay's own coordinates, so it moves, scales and fades
  with the overlay, is painted only inside its outline, and is exported with it. A
  Projection-aware overlay's flag is framed again over the land where it has been put.
- **In Flags mode.** Overlays work as in any other mode: drawn above the flags, and dragged,
  sized and textured the same way.

**An overlay copies a shape; it never takes it.** It records the entity it copies and where it
has been put, and nothing else. The document keeps no geometry for it: the outline is worked
out from the map's own data every time it is drawn (`src/render/overlayGeometry.ts`). So it is
exact at every resolution and in every projection, with islands, holes and exclaves as the map
has them, and nothing done to an overlay can move, recolour or merge the entity beneath it.
The overlays are their own list in the document (`create_overlay`, `update_overlay`,
`delete_overlay`), so they are undoable like every other edit.

**Where it has been put is a point on the globe**, not on the screen. Zooming, panning,
reframing and changing projection all leave an overlay over the same place. The two modes differ
only in how that point is honoured:

- **Shape** draws the entity's outline exactly as the map draws it where it is, slid so the
  centre of its main landmass lands on the point. It is the same picture wherever it goes, at
  the same size as the entity on the map.
- **Projection-aware** carries the entity's land across the sphere. Two rotations take the
  centre of its main landmass to the point, and the active projection then draws it there.
  Rotations keep true size and shape on the globe, so what changes on the map is only what the
  projection does to land at the new place. Greenland dragged to the equator on Mercator comes
  out the size it really is.

**Size.** Every overlay has its own size, from 10% to 500% of the entity's, on a slider next to
**Reset size**. The slider is logarithmic, so halving and doubling are the same distance and the
entity's own size sits near the middle; it snaps to 100%. Scaling is one uniform transform of the
drawn overlay about the same centre it is dragged by, applied after it has been placed:

- its proportions are exact;
- every island and exclave keeps its place relative to the rest;
- resizing never moves it, whether or not it has been moved;
- dragging, colour, opacity, texture and mode are all independent of it.

The outline keeps its width on screen, and the texture is spaced against the scale as well as
the zoom, so a 500% overlay is hatched as finely as a 10% one. Nothing about the map changes
— not the entity, not the projection, not the zoom — and the size is a multiple of the
geography, never a size on screen, so an overlay of Vatican City still grows and shrinks with
the map exactly as Vatican City does.

The centre an overlay is carried by is its main landmass's, not the whole entity's. France's
centre over all its land lies in the Atlantic, between Paris and French Guiana; its mainland's
is in France, which is where a hand dragging France expects to be holding it.

**Overlays take the pointer in every mode, whichever panel is open.** A press on an overlay
chooses it and drags it: the map does not pan, the brush does not paint, and no country is
selected or recoloured. This is so in Flags mode too. There, the Data panel is usually the one
open, and overlays used to answer only while the Overlays panel was: a drag on one panned the
map and a tap selected the country beneath.

A drag follows the pointer's own movement in the map's coordinates, so it tracks the finger at
every zoom. It is drawn from local state while it runs and committed once, on release, as one
undo step. The wheel and a two-finger pinch still zoom the map from anywhere. A country an
overlay covers is reached by moving the overlay off it.

**Drawn over the map and inside the camera.** The layer is the last thing in the zoomed group,
above the names, so it moves with the land and is exported with it. The tint, texture and
outline are all in the overlay's colour, so it never reads as the land it covers. The texture
is spaced in screen pixels and the outline does not scale, so neither thickens as the map
zooms.

**Nothing marks the chosen overlay.** It looks exactly as it does when it is not chosen, and
which overlay is being edited is shown in the Overlays list alone. There used to be a dashed
outline and a round handle on it; both read as a selection marker over the map, and both are
gone. An overlay is dragged by its own shape, so one of Vatican City is taken hold of once the
map is zoomed in far enough to reach it, or moved with **Move over**.

Verified in the browser:

- **At home.** An overlay of France started with exactly France's path, and France's own path
  and colour were unchanged throughout.
- **Dragging.** A 200 × 60 px drag moved it exactly 200 × 60 px. After zooming to 2.25×, a
  90 × −40 px drag moved it exactly that much again. Neither drag moved the camera or changed
  the selection.
- **Undo and redo** took the move back and put it again; **Reset position** returned the
  overlay to its home.
- **Merged group.** An overlay of an Iberia group had all 49 subpaths of the merged body.
- **Micro-nation.** Vatican City was drawn at its size on the map — then its true 0.004 px,
  now six times that (see *No minimum rendered size*).
- **Projection-aware.** On Mercator, Greenland moved to the equator came out at 5.6% of the
  area of its box at home (2,292 against 40,581 px²). In Shape mode the same overlay kept its
  40,581 px².
- **Export.** The overlay and its texture were in it.
- **Island water** was unaffected. With overlays on the map, the zones drawn were exactly the
  ones the map's own rules draw.
- **Create overlay deselects what it copies.** The cases: a country, two countries, Monaco, a
  merged group and a region of the Detailed World Map. In each the selection was empty afterwards,
  the new overlay was the one being edited, and the original was back in its own fill. Nothing
  else was drawn with it. One undo restored the selection and removed the
  overlays; redo put both back.
- **Flag texture.**
  - France's overlay showed the tricolour on the mainland, and French Guiana carried its own.
  - The United States' overlay showed the whole flag on the lower 48, and Alaska its own.
  - A Belgium + Netherlands group showed the flag chosen for it.
  - Changing France's flag afterwards left the overlay's alone.
  - The export carried the flag pattern with its artwork inline.
- **In every mode and panel.** A drag on an overlay's own shape moved it, with a mouse and
  with a finger, without panning the map or selecting anything beneath. The cases:
  - normal mode;
  - Flags mode with the Overlays panel open, and with the Data panel open;
  - flag-filled, hatched, scaled and merged overlays;
  - a region of the Detailed World Map.
- **No marker.** The overlay layer drew exactly the same markup with an overlay chosen as with
  none chosen. That held for flag-filled, hatched, scaled and merged overlays, after a zoom and
  a pan, and in and out of Flags mode. No circle, handle or outline was drawn anywhere in it.
- **Detailed World Map.** An overlay of the Budjak started as exactly the Budjak's path and
  dragged exactly 150 px. The Budjak and Odesa beneath it were unchanged.
- **Phone.** On a phone-sized viewport, a touch drag moved an overlay exactly 60 × 40 px
  without panning the map.
- **Size.**
  - **After a move:** set to 50%, an overlay of France came out at exactly half its width and
    height. Its centre did not move by a pixel, and neither did its anchor, the camera or
    France.
  - **At 500%:** five times the width and height, still centred, with the texture spaced at a
    fifth of its step so it looked the same on screen.
  - **While zoomed in:** a scaled overlay dragged exactly as far as the pointer went. Resizing
    it at 2.25× zoom scaled it about its centre too, and **Reset size** left its position
    alone.
  - **Projection-aware:** it scaled the same way.
  - **Merged group and micro-nation:** a merged Iberia at 300% kept all 49 of its parts, and
    Vatican City scaled five-fold.
  - **Export:** the scaled transform was in it, the editor outline was not, and island water
    still drew all 72 bodies.

### The composition frame

The **Screen** is the part of the canvas that is the map. Everything inside it is the
picture and is what the exporter writes; everything outside is workspace, shown under a
light blur so the surrounding geography stays readable while making plain it is not in
the shot.

It is stored as a rectangle in viewport pixels rather than as an aspect alone, because
an author who drags an edge is stating where the picture ends and that is not a ratio.
Nothing reads that rectangle directly: `resolveScreen` is the one place that decides what
the frame is right now, so a composition made on a wide monitor and reopened on a laptop
clamps to the nearest frame that fits instead of disappearing. `null` means the frame is
the whole canvas — an uncomposed map frames and exports exactly as it did before the
frame existed.

**The frame is placed over a composition; it does not decide one.** `buildProjection`
knows nothing about it. It briefly did — the region was fitted to the frame's rectangle,
which made the aspect-awareness fall out for free and made switching the frame on
re-frame the map, which is exactly what a frame must not do. Verified after the fix: the
projection is byte-identical through enabling the frame, three preset changes and
disabling it again — same scale, translate, rotate, zoom and path data.

The aspect-awareness comes from the same geometry read the other way round. **Fit to
region** measures where the region already is on screen — projected, through the live
camera — and puts a rectangle round it, so the composition's shape is derived rather than
declared. Africa arrives tall, Europe and Asia wide, South America narrow, with no
continent named anywhere; and because the input is the *projected* outline, the same
region answers differently under every projection: Africa runs 0.81 under Equal Earth to
1.08 under Nell-Hammer, Europe 1.00 under Mercator to 1.87 under Nell-Hammer. Audited
across 36 region x projection pairs: worst off-frame **0.19%**.

The frame is **off by default** and has its own switch, so an untouched map is exactly
what it always was and turning the frame off and on again returns the composition rather
than discarding it. **Freeform** releases the ratio so every edge moves alone; a preset
holds its ratio through a drag, taking the dragged edge at its word and letting the other
axis answer.

The overlay lives inside the map and stops there. That is not automatic: `position:
relative` alone leaves `z-index: auto` and creates no stacking context, so the sidebar's
panel competed directly with the map's overlays and the frosted scrim painted straight
across the sidebar. Naming a context on the sidebar puts it above the map workspace,
which is the true relationship — the frame composes the map, and the sidebar is not part
of the map.

The overlay is **HTML, not SVG**, and deliberately. Everything else the map draws lives
inside the `<svg>` so the exporter picks it up for free; this is the one overlay that must
never be exported, and the surest guarantee is for it not to be in the thing the exporter
copies - no marker attribute to remember, no stripping pass to keep in step. The dimmed
workspace is four plain rectangles around the frame rather than one element with a hole
cut in it: a clip-path or a mask would re-rasterise the whole overlay on every pointermove
of an edge drag, where four rects change only their own geometry and `backdrop-filter`
composites what is already painted underneath.

**Edges change the shape; corners scale the shape you have.** That is the whole division
of labour, and it is what makes Freeform feel like a design tool rather than four
independent sliders: you draw the crop you want with the edges, then a corner makes that
crop bigger or smaller without disturbing it.

So a corner holds a ratio in Freeform too — but the frame's *own* ratio, read off it at
the moment the gesture began rather than named by a preset. A 1.4:1 frame scales as
1.4:1, a 2:1 frame as 2:1, a tall 0.58:1 frame as 0.58:1, and nothing is ever snapped
back to a preset. Reading it from the rect at drag start rather than from the live one is
what stops the shape drifting over a long drag by re-measuring its own output. A preset
names its ratio instead; that is the only difference between the two cases, and an edge
has no corner ratio at all, so it goes on moving one axis alone.

The scale itself is the drag's component along the frame's **own diagonal**. Projecting
rather than following one axis is what lets the gesture answer to movement in any
direction — pulling a corner straight down grows the frame just as pulling it out along
the diagonal does, and pushing back towards the anchor shrinks it. Steering by width
alone would leave vertical movement doing nothing, which reads as a broken handle. The
opposite corner is then put back exactly where it started; without that, holding a ratio
slides the anchor and the gesture feels like it is dragging the whole frame around.

Measured on a 420x300 frame (1.4:1), every corner dragged outward and then back in:
490x350 out and 448x320 in, ratio **1.400** at every step, opposite corner fixed to the
pixel — for all four corners. A 600x300 frame stayed at exactly **2.000** through an
outward and an inward corner drag; a 300x520 frame stayed at **0.577**; a purely vertical
corner drag grew the frame and held 1.4. The edges meanwhile still reshape freely — right
+80, bottom -60, left -50, top -40 took one frame from 1.4 through 1.667, 2.083 and 2.292
to 1.964, each moving one axis only — and a corner then locked that arbitrary 1.964
exactly while scaling it up. Presets are untouched: a 16:9 corner drag came back at 1.778
with its anchor held and its aspect still `16:9`. Projection and camera transform were
byte-identical throughout.

Each corner is a 20px square hit area carrying an 11px mark that is only the two strokes
of its own angle, drawn in the accent at the same hover-and-drag opacity the edge bars
use: easy to grab, and at rest the frame still reads as a hairline rather than as a
control panel. The corners are painted above the edges they share a point with, since at
that point the corner is the more specific intent.

**Moving the whole frame.** Drag anywhere inside the picture and the frame follows the
pointer; drag an edge and it resizes. Only the *position* changes — the width, the
height, the ratio, the projection, the zoom and the translation are neither read nor
written, so a moved frame is the same crop in a different place. Measured: a
(-110, +60) drag moved the rect by exactly (-110, +60), left width, height and `16:9`
untouched, and left the camera transform byte-identical.

Deliberately **not** implemented as an overlay covering the frame, which is the obvious
way to catch a drag and the wrong one: an overlay that large would swallow every hover
and every click inside the picture, so the country readout would go quiet and most of
the map would stop being selectable the moment a frame was drawn. Nothing is covered.
`pointerdown` is taken on the map element in the capture phase, and `mousemove`,
`mouseover` and `click` are left entirely alone — clicking a country inside the frame
still selects it (verified on Poland), and hovering still reports it.

Keeping the map still under the gesture is the other half. The matching `mousedown` is
stopped before it reaches the `<svg>` d3-zoom listens on — the same problem the legend
solves with a clause in d3's own filter, solved the same way round: a gesture belongs to
whatever it started on, so an edge handle stays a resize and the legend stays a legend
drag. A second finger is left alone, so pinch-zoom inside the frame still reaches the
map, and the wheel is untouched: scrolling inside the frame still zooms (3.38 -> 4.71).
Outside the frame nothing changed at all — a drag there pans the map exactly as before,
by exactly the drag delta, and leaves the frame where it is.

A move that actually moved swallows the click that would otherwise follow it, the same
guard d3-drag uses so a pan does not double as a selection; a drag that never passed the
3px threshold is left alone, so a click inside the frame is still a click. Like an edge
drag, the gesture is held in local state and commits **one** operation on release. The
scrims, the frame and the four handles all follow, and the export follows with them: the
`viewBox` tracked the moved rect exactly, `600 200 360 203` and then `60 40 360 203`.


An edge drag holds the frame in local state and commits **one** operation on release. The
frame is what the projection is fitted to, so committing per pointermove would re-fit the
projection and rebuild every projected path on every frame of the gesture. Measured over
an eight-step drag: the projection scale stayed at a single value throughout and the
document was untouched, with one re-fit when the edge was let go.

Cropping the export is a `viewBox`, not a clip. The map is drawn in viewport coordinates,
so naming the frame's rectangle as the view box shows exactly that part of exactly the
same scene - nothing re-laid-out, nothing masked, and the frame itself never appears as a
border. The output's pixel size comes from the frame too, so an exported image carries
the aspect that was composed rather than the browser window's. The frame is published on
the `<svg>` as data attributes and read back by the exporter, so every existing export
path - PNG, JPG, SVG - is cropped without being changed.


### Templates

**Templates**, the second section of the sidebar — right after Maps — lists built-in presets. Click
one and the editor is set up for that kind of map at once, instead of switching half a dozen
controls by hand. They are part of the application: no accounts, no saving, no creating your own,
nothing stored anywhere.

Each template is a constant in `state/templates.ts`, keyed by the document's own settings — the
colouring mode, `flags`, `style`, `labels` — never by a panel or a control, so rearranging the
sidebar cannot break one. Applying it builds fresh operations from it and dispatches them through
the store like any other edit: validated, one step, and every setting it wrote can be changed by hand
afterwards. Only the settings a template names change; the map's data, groups, merges, overlays,
flag assignments, region and projection are left as they are. The templates are deep-frozen, so
nothing — another template, a manual change, an undo — can alter a preset, and applying one twice
sets the same thing twice. A template may name the section to open afterwards, where the work it
sets up is done.

Choosing the colouring mode is shared with the mode chips in Styles & Data (`state/colourMode.ts`),
so a template turns Flags on exactly as clicking **Flags** does — the layer's scale set aside, the
comparison off — rather than a second copy of that rule.

**World Domination** — a map of flags where countries take each other's:

- Flags mode on, with the World Domination override armed but no dominating country chosen, so
  every country keeps its own flag until one is picked;
- Borders off, so a country that has taken its neighbours reads as one territory; Coastlines on;
  High-Contrast Borders and Island Water Coverage off;
- Region names, data values and Compare group values off, and Water Regions off, so a click on
  the sea never gets in the way of picking countries;
- then it opens Styles & Data on Flags: select countries and use **Change Flag** to give them
  another country's flag, or pick one flag in **Choose flag** to cover the whole world.

**Predefined Data**: published figures on the map, with nothing typed in. It is one template for
every dataset. Click it and the datasets open under it: **HDI**, **GDP per capita**,
**Inflation** and **Population**. Choose one and, in one edit:

- the dataset's values go onto every entity of the open map that has one, after the active layer's
  old values are cleared so nothing stale is left;
- Data mode turns on with the **Predefined** scale and the dataset's own fixed thresholds;
- the layer takes the dataset's name and unit ("$", "%"), so **Data Values** print "$90,027";
- the legend is shown, with the source and year as its subtitle;
- Styles & Data opens on Data.

The map on screen decides which values are used. `levelOf` reads the loaded entities' ids and
works out whether they are countries (ISO 3166-1 alpha-3), US states (`US-CA` on USA States,
`state-06` on the Official map) or US counties (`county-06037`). A world map gets the countries'
values whatever region is framed. A map of Europe shows Europe's values, and reframing it to the
world shows everyone's without applying anything again. The USA maps get the Census Bureau's
state or county populations.

If a dataset has no figures at the map's level, the list greys it out and says why: HDI, GDP per
capita and inflation are "Not published for US states". The administrative world's provinces and
the US county subdivisions get no values at all, rather than values that belong to something else.

| Dataset | Countries | US states / counties | Thresholds |
|---|---|---|---|
| HDI | UNDP HDR 2023/24, 2022 (193) | — | UNDP's four tiers |
| GDP per capita | World Bank WDI, latest year (213) | — | World Bank FY2025 income groups (set on GNI per capita) |
| Inflation | World Bank WDI, latest year (193) | — | Editor-defined: below 0, 2, 5, 10, 25 % |
| Population | World Bank WDI, latest year (216) | Census Vintage 2023 (52 / 3,144) | Editor-defined, per level |

The figures are JSON files in `src/data/predefined/`, rebuilt from the publishers' releases by
`node scripts/build-predefined-data.mjs`. Each file is imported only when its dataset is chosen,
so the page never loads data nobody asked for. **To add a dataset**, add it to the build script,
add its threshold scale(s) to `state/presets.ts` and add an entry to `PREDEFINED_DATASETS` in
`data/predefinedData.ts`. The template and the panel list whatever is there and need no change.

This is not the Palette. **Data → Palette**, where the author types values and the colours follow
their range, is untouched and one chip away. **Data → Predefined**, which picks a threshold scale
for values already on the map, is still there on its own. The new scales appear in its list too.

Adding a template is adding an entry to `TEMPLATES`.

### SVG round trip

**SVG**, the last section of the sidebar, takes the selected map out as a blank SVG and an edited
one back in. The workflow is the whole design: pick a map, **Download SVG**, have something else —
ChatGPT, a drawing program, a script — add data to the file, and drop it into the box under the
button (or click the box to choose it). No categories to pick, nothing to map: the file is read
and what was added to it is applied to the open map, as one undo step. See `io/svgExchange.ts`.

**The blank map** is geography only — no data, palette, legend, flags or other customisation. It is
the land the canvas projected for the selected map, dataset and projection, insets included, so it
costs no reprojection. Every entity is one `<path>` in `<g id="entities">`, identified in every way
an outside editor is likely to keep or recognise: `data-id` (the editor's own id), `id` where that
id is a valid XML name, `data-name`, `data-iso2`, `data-iso3`, `data-iso3166-2` and `data-country`
on the administrative map, and a `<title>` with the name. Entities a merge or Hide keeps off the
screen are in it too. Paths are rounded to a tenth of a pixel — invisible, and a third of the size —
except where rounding would collapse one to a point, which keeps full precision: Vatican City is in
the file as its drawn shape. A `<desc>` tells whoever edits it the conventions: `fill` for a colour,
`data-value` (or any named `data-*` number) for a value, `<g id="legend">` with a swatch and a label
per item, `<text id="title">` for a title. Sizes: 0.2 MB at 110m, 1.1 MB at 50m, 6.5 MB at 10m and
15 MB for the administrative world (3,153 units, built in under a second).

**Reading it back** matches each element to an entity by `data-id` or `id`, then ISO 3166-2, ISO
alpha-3, ISO alpha-2 and name — a key two entities share identifies neither and is skipped — so a
file whose ids an editor stripped still matches by name. From each it takes its own fill (attribute
or inline style, any CSS colour, never an inherited one; the blank fill counts as none) and its
value. Then, in one batch:

- **Values** become the active layer's values — real numbers, which the editor can re-colour later.
- **Colours** are kept exactly: each value is pinned to the colour it was given through the
  categorical scale's `categoryColors`, so the map looks the way the file does. The Data panel shows
  this as a third scale, **Imported**; Palette or Predefined colour the same values with the editor's
  ramps. An entity coloured without a number gets its legend label (or its colour) as its value.
- **The legend** is the file's own — `legend.source: 'manual'` and its `entries`, fields the document
  already had and nothing read, now shown while the Imported scale is in use — in the file's order,
  with its title. A file with colours and no legend gets one built from them, each colour labelled
  with the range of values it covers.
- Numbers **without** colours are coloured by the editor's own palette, with the usual ramp legend.
- A `title` becomes the caption, and names written onto the map turn the names layer on.

The layer's previous values are cleared first, so the map shows what the file says, and one undo
takes the whole import back. A file that matches nothing, a file with nothing added, and a file
that is not SVG each get a sentence saying so and change nothing.

Checked on the Modern World map (10m, 50m, 110m) and the administrative world: a file edited the way
ChatGPT edits — fills as attributes, inline styles and `rgb()`, `data-gdp` numbers, a legend group
with a title, a title text, one country with its ids stripped — dropped on the box came back with
every colour exact, every value real, the legend's four rows in order under its title, the caption
set, and one undo step; on the administrative map, units matched by id, by ISO 3166-2 alone and by
name alone, Vatican City among them.

### Export

Three formats — PNG, JPG, SVG — and one rule behind all of them: **the export is a
capture of the live map, not a second rendering of it.** `render/exportMap.ts` reads
the `<svg>` element already on screen and knows nothing about projections, framings
or countries. It cannot get them wrong, because by the time it runs they are facts
about a DOM node rather than decisions to re-make. A map zoomed 2.25× into Robinson
Europe with two countries selected and a threshold palette exports as exactly that.

    live <svg>  ->  clone + make self-contained  ->  SVG text
                                                      |
                                           +----------+----------+
                                           |                     |
                                         .svg            raster -> .png / .jpg

PNG and JPEG go through the same SVG text, so there is one representation and no way
for the two to disagree. That also makes the whole operation read-only by
construction: the element is cloned before anything touches it, and the store, the
document, the camera and the selection are never written — verified by comparing a
full serialisation of the state either side of every export.

**Scope.** The zoom buttons, the hover label and the loading notice are HTML siblings
*outside* the SVG, so copying the SVG excludes them with no filtering to keep in sync.
The assist catchments that make microstates clickable were never rendered at all, so
they cannot leak either.

**Self-contained.** Only `cursor` and `display` are set from CSS on this SVG — every
paint attribute is written from `doc.style` — but the export resolves computed paint
onto the clone and drops `class` anyway, so the file does not depend on that staying
true. The result renders identically in a document with zero stylesheets.

**Resolution.** Raster exports default to 2×, widening the viewport without touching
the `viewBox`, so more device pixels carry the identical composition. One subtlety
earns its code: `vector-effect: non-scaling-stroke` measures stroke width in *device*
pixels, which is what keeps borders hairline-thin at any zoom — and which would draw
them at half weight in a 2× export. Those widths are scaled with the viewport so the
picture matches the one being captured.

Verified by sampling the exported pixels against the live DOM across every region,
projection, palette mode, theme and toggle: 100% match. The magnifier is not exported:
it is an editor aid for seeing a selected speck, not part of the map, so its lenses are
marked `data-export="none"` and come out of every PNG, JPG and SVG with the legend's
resize corner.

### Undo

Undo is a stack of snapshots, not inverse operations: the document and the selection as
they stood before each edit. The executor already returns a new document and never
mutates the old one, so the previous state is simply the value that was there a moment
ago — and because every unchanged branch is shared by reference, keeping it costs the few
objects the edit actually replaced. Inverses would mean writing and maintaining an undo
for every operation in the vocabulary, and getting one of them subtly wrong is how undo
stacks start lying.

Two kinds of edit make a step. Content operations (`UNDOABLE_OPERATIONS` in
`state/operations.ts`) — values, groups, merges, the legend, the names. And selection
changes: a click, a Clear, a rectangle, a brush stroke, and the merge groups that collect
a selection. A selection on the administrative world can be a hundred subdivisions built
stroke by stroke, and getting the last stroke back is exactly what undo is for. The two
are restored together, so undoing a Palette value brings back the value *and* the
selection it was typed into — the Palette letting go of a selection once its value lands
is part of the same step (`clearSelectionWithLastEdit`), as is Compare's "Add selected".

Changing the region, the projection, the dataset or the style recomposes the view rather
than editing the map, so it makes no step — and an undo or redo leaves those as they are
now rather than rolling them back with the snapshot, so Ctrl+Z never moves the camera. A
rejected operation, an edit that changes nothing, and a click or stroke that selects
nothing new all cost no step.

Edits sharing a `coalesceKey` and arriving within 700 ms extend the step already on the
stack rather than adding to it, so typing "1200" into a value field is one undo, not
four. A pointer gesture has a key of its own for as long as it lasts, so a brush stroke
that adds to the selection on every frame, however slowly, is one step, and so is a
rectangle. A new edit after an undo discards the redo stack.

Shortcuts are the standard ones: Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo (Cmd on a
Mac). They are the map's only while nothing is being typed — in a text field Ctrl+Z is the
field's own undo of the typing — and the buttons call exactly the same functions.

### Trying the operation pipeline

In dev, the console exposes the exact surface the AI will target:

```js
__mapEditor.dispatch([
  { op: 'set_country_value', countryId: 'ROU', value: 10 },
  { op: 'set_country_value', countryId: 'BGR', value: 18 },
  { op: 'create_group', groupId: 'group-1', name: 'Balkans', members: ['ROU', 'BGR'] },
  { op: 'add_to_group', groupId: 'group-1', countryIds: ['SRB'] },
  { op: 'set_active_palette', paletteId: 'red-9' },
])
```

Invalid operations are rejected individually and reported, never applied. A batch may
create a group and then use it, because group ids are re-read from the running
document between operations — which is the shape an assistant's batch will take.

## Not implemented yet (deliberately)

- **AI assistant** — the operation vocabulary and validation exist; no model call. The
  editing UI deliberately adds no path the assistant will not have: every control in
  the inspector and the groups panel is one `dispatch`, so there is one editing system
  rather than a manual one and an automated one.
- **Document persistence** — settings persist; the document does not, so a refresh
  starts a new map. The model is plain serialisable data and the operation log is
  already kept, so this is a storage decision rather than a modelling one.
- **Legend** — the legend model exists in the document; nothing renders it yet. The
  palettes and comparison colours are all the reader currently gets.
- **Export** — the renderer is SVG so PNG 1920×1080 and SVG export are reachable; no
  export code yet. The button is present and disabled.
- **Historical datasets** — registry supports them; none registered. The three
  modern resolutions (110m / 50m / 10m) are the only entries; 10m is the default.
- **Geometry editing** — `rename_country`, `merge_countries`, `set_border` and the
  rest are listed in `PLANNED_OPERATIONS` and rejected with a clear reason.
- No backend, no auth, no database. Everything runs client-side.
