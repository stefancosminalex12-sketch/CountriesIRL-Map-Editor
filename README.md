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
| Geography | `world-atlas` (Natural Earth TopoJSON, 110m/50m/10m) | real vector polygons, no API key, no usage cost |
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
    supplementalGeometry.ts  generated Natural Earth admin-0 shapes
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
  audio/sfx.ts        centralised sound effects
  state/settingsStore.ts  theme + volume, persisted to localStorage
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
   nothing is ever drawn twice. Vatican City comes from the supplement at 110m and
   10m, and from the dataset at 50m.

   Most gaps are not about quantisation but about editorial scope: world-atlas ships
   the same countries at three resolutions and the coarser two leave out whatever is
   too small to draw. The 110m layer names 177 of the 254 entities this app knows and
   the 50m layer 240, so on the 110m map Monaco, Malta, Singapore, Hong Kong, Bermuda
   and 72 others simply did not exist. `lowDetailGeometry.ts` closes that gap for all
   77, and is generated rather than hand-kept: an entity is there because a layer has
   no geometry for it, and would leave again if a future dataset supplied one. See
   *Entities a coarse dataset omits* below.

   `replace` overrides geometry that exists but is incomplete. `world-atlas` derives
   its country layer from Natural Earth but simplifies and merges it, and Bahrain
   loses its archipelago on the way — one polygon of 587 km² against the
   authoritative seven totalling 689 km². The missing 15% is Muharraq, Umm an Nasan
   and the whole Hawar group, and since Hawar sits against Qatar's west coast, losing
   it is what leaves that stretch of the Gulf looking empty. The replacement is
   Natural Earth's own 10m admin-0 geometry, generated into
   `supplementalGeometry.ts` by `scripts/fetch-country-fixes.mjs` and unmodified
   apart from coordinate rounding.

   A supplement declares which resolutions it applies to, so 10m coastlines never
   leak into the 110m map — Bahrain's `replace` fix is scoped to 10m and leaves 50m
   and 110m exactly as they were, and every low-detail fallback is scoped to the
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
draws the fifty states. Choosing between them is a subsection of Map, and it is meant to
feel like changing the dataset inside one editor rather than opening a second application
— because that is what it is.

An **atlas** (`maps/atlas.ts`) is a thin description: its datasets, its regions, what one
of its entities is called, and any inset layout its geography needs. Nothing downstream
knows atlases exist. Selection, values, palettes, thresholds, comparison, merging, flags,
the legend, the composition frame and export all read *entities*, and they read them the
same way whether the entity is France or Nevada. Adding Canadian provinces later should be
a dataset, an entity table and an entry in that file.

**Identifiers are namespaced by construction**, which is what makes the whole thing safe.
Countries are ISO 3166-1 alpha-3 (`USA`), states are ISO 3166-2 (`US-CA`). No two atlases
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

**The data** is Natural Earth's 10m admin-1 layer, filtered to the 51 US entities by
`scripts/fetch-us-states.mjs` and vendored, exactly as the lakes are — the whole-world file
is 40 MB and the app should not download Bavaria to draw Nevada. It is built into TopoJSON
at prepare time rather than shipped as GeoJSON, and that is a capability rather than a
storage detail: shared arcs are what `mesh` reads to find the boundary between two states
and nothing else, and what `topojson.merge` dissolves when states are merged. 520 arcs,
and a CA+NV+AZ dissolve drops from 2,475 vertices to 1,887.


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

### Entities a coarse dataset omits

The three world-atlas resolutions are not the same map at three levels of detail —
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
source. Vatican City stays hand-maintained, since no layer at any resolution can
supply it. Every coordinate is a real Natural Earth lon/lat carried over from a
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
cannot be clicked. Three editor-only affordances make the map usable without forcing
the user to zoom, and they are deliberately independent of one another:

- **assisted selection** — an invisible catchment that follows a country's actual
  islands, so a speck or a scattered archipelago can be hit;
- **the magnifier** — an enlarged copy of a selected feature's own outline, so a
  selected speck is visible;
- **the minimum rendered size** — a legibility floor, so a sub-pixel polygon is drawn
  as something rather than as nothing.

The last two are keyed to whole countries below `SMALL_ENTITY_AREA_KM2` (1,000 km²,
in `geo/metrics.ts`). Assisted selection is not, because being small is not the same
problem as being scattered.

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

#### The magnifier and the rendering floor

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

**The rail is two levels deep.** Ten flat sections asked the reader to hold ten unrelated
names in mind to find one control; grouping them puts the question first — is this about
the map, about the data, or about the editor? — and each group's parts sit behind a
`Disclosure`, the same component the legend's panel size already used. Six top-level
sections now:

```
Settings   Style · Sound
Map        Region · World · Display
Screen
Data       [modes and their workflows] · Merge
Legend
AI
```

**Region**, **World** and **Display** are in the order a map gets made: what area, then
which data and which projection, then which layers are drawn. The first subsection of a
group is open when the group is chosen, so opening Map still lands on Region exactly as
the flat rail did. `Screen` is deliberately still top-level: it is a composition and
export frame rather than a property of the map, and folding it into Map would have put a
fourth thing in a group whose three parts are about what the map *is*.

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
`ThemePicker`, `SelectionHighlight` and `SoundSettings`; `LegendControls` gave up its
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

### Themes and sound

`theme/themes.ts` holds three themes, each split into two parts:

- `ui` — interface tokens written onto `document.documentElement` as CSS custom
  properties. No component hardcodes a colour; the stylesheet only ever reads
  `var(--…)`, so a new theme is one entry in that file and nothing else.
- `map` — the map's own colours, applied through the normal `set_style` operation.
  Map colour is map *content*, so it belongs in the document and in an export;
  interface chrome does not.

Each theme defines a five-level surface ladder — backdrop, panel, section, control,
inset — with steps large enough that the interface reads without borders doing all
the work. **Dark** is cool graphite (`#1a1e24` backdrop, never black) with soft
blue-white text. **Light** is daylight grey with panels *lighter* than the backdrop,
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

`audio/sfx.ts` owns the audio context, buffer cache and master gain. Components call
`playSfx(name)` and never touch volume. The assets are local WAVs generated by
`scripts/generate-sfx.mjs`: a family of seven short tactile clicks (50–180 ms) built
from a damped sine body, a few milliseconds of low-passed noise for contact, and a
raised-cosine attack that removes the harsh edge. `toggleOn` and `toggleOff` are one
gesture in two directions — the same contact made and released, differing in pitch
and in which way the tone bends — so a switch is audibly not a dropdown while still
belonging to the same set. Sounds are attached only to discrete actions — selection,
controls, switches, panels, themes, region changes. Continuous gestures (hover, drag,
zoom) are silent, deliberately: a sound that fires whenever the pointer crosses a
control is the one in a set like this that reliably becomes irritating. Both theme
and volume persist to localStorage.

Writes are **debounced**. `localStorage.setItem` is synchronous, and two of these are
dragged rather than clicked — the volume slider and the selection-highlight well both
fire on every input event, so one drag was serialising and writing the whole preferences
object sixty times a second on the main thread. That was the jank in the Sound section.
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
own registry and its own style tokens, and never touches the country geometry — the
country TopoJSON files in `public/geo/` are byte-identical to the Natural Earth
originals. A future layer (rivers, glaciers, urban areas) is another module of the
same shape rather than a change to the country data.

The lake data is Natural Earth's lakes filtered to `scalerank <= 5`, which is the
cartographers' own judgement of what belongs on a general-purpose map: 336 of the
1,355 lakes at 10m, covering every major lake in the world plus small-but-notable
ones like Geneva and Bodensee, without the ponds. `scripts/fetch-lakes.mjs` rebuilds
the vendored files from source; it is a maintenance script and is NOT part of the
build, so ordinary builds stay offline.

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

### Minimum rendered size

Some entities are too small to draw at all: Vatican City is 0.16 px wide at Europe
zoom, which rounds away to nothing. `minimumSizeTransform` in
`render/smallEntities.ts` gives every feature a floor of `MIN_RENDERED_SIZE_PX`
(3 px) by scaling its own projected outline about its own centre.

The factor is only ever `3 / (size on screen)` — the least enlargement that clears
the floor, never more. As the camera zooms in the real feature grows, the factor
falls smoothly toward 1, and the moment the genuine geometry reaches 3 px the
transform is dropped and the feature is drawn untouched. For Vatican City at 10m
that handover happens at about 19x zoom.

It applies only where the WHOLE feature is under the floor, which is what keeps
scattered archipelagos out: scaling one about a common centre would push its islands
apart and misplace them. At Europe zoom it touches 18 of 254 features — Vatican,
Monaco, Gibraltar, San Marino and similar — while Liechtenstein (3.8 px), Malta,
Andorra and every large country are left alone.

This is a rendering level-of-detail treatment. It is a `transform` attribute on the
path element; no stored coordinate, no `MapDocument` geometry and no area
calculation changes, and it is independent of both the assisted hit areas and the
selection magnifier.

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
appears under the Flags control and governs this layer alone: the flags on land, the
floored islands and the separately framed territories are untouched either way. It is a
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

Nothing about it is derived from where the islands sit. An earlier version buffered the
islands' own geometry and dissolved the result; it was built from real geometry, but
around a lone island a buffer is a disc however it is computed. What replaced it is the actual zone: French Polynesia's
water is the four-lobed shape its island groups earn it, Kiribati's is three separate
zones because the Gilbert, Phoenix and Line groups are three separate places, and the
boundary between two neighbours is the median line the dataset draws, not an arc.

Natural Earth, which supplies everything else here, has no equivalent — it carries
maritime *indicator lines*, bathymetry and named sea regions, none of which is a
country-associated area — so this is the one layer that comes from elsewhere:

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

**Scattered island countries are also held at a minimum drawn size.** A Maldivian atoll
is about a twentieth of a pixel at world zoom: its flag is fitted correctly and rasterises
to nothing. Each island is floored **about its own centre**, so the shape is the island's
real outline and its centre does not move. `smallEntities.ts` already does this for a
country small enough to vanish whole, and says plainly that it cannot help a scattered one,
since scaling those about a single centre would push their islands apart — this is the
same idea applied per island. The factor falls to 1 as the camera comes in: **233 islands
floored at k=0.5, 232 at k=1, 220 at k=2, 167 at k=8, 69 at k=32, 4 at k=128, none at
k=512.** No cliff, and no threshold that hides anything.

**A floored island may never reach another country.** Growing one is exactly how a flag
ends up on someone else's land: Guantanamo Bay is an enclave inside Cuba, and flooring it
put the American flag on Cuban soil — 44 sampled points landed in the wrong country. Each
island may grow into only half its measured distance to the nearest other coastline, and
the floor applies only to countries whose land is genuinely *spread* — at least five times
the size of its own pieces, the distinction between a country made of many islands and one
normal polygon with a couple beside it. The Maldives spread their atolls two hundred times
their own width and Saint Vincent's islets some eight times; Macau's pieces and Hong
Kong's are under three times theirs, so they are left alone. **247 islands across 24
countries, 3,652 sampled points inside them: none in another country.**

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
rule measures its land, and the island floor measures it again to pick candidates and
again to find neighbours; each full pass of `path.bounds` and `path.area` over 4,252
polygons costs 1.3 seconds. They can share, because `flagPlacement.ts` puts the feature's
own coordinate arrays into its clusters rather than copying them, so a cluster's polygon
is reference-identical to the country's — a `WeakMap` keyed on the array, and on the
projection, collapses the four passes into one.

*The island floor built a neighbour table for the whole planet.* It projected ring points
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
time, with byte-identical output: the same 247 tiles, 248 floored islands, 68 maritime
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
The island rendering floor and the maritime layer *are* kept, painted from the same
override, so scattered archipelagos stay visible and island water keeps working.

It is an **override, not an edit**. The footprints, tiles, territories and island floor
are built exactly as they always are and are not consulted about it, so the switch
changes only which paint server the shapes point at. Turning it off restored all 247
per-country fills with zero differences from before it was turned on, and brought the 18
territory placements back; the chosen country is remembered, so flicking it back on
returns to the same flag rather than an empty field.

Export carries it for the same reason everything else does — the exporter copies the
SVG. Measured: the world pattern present, **zero** per-country patterns, 506 references
to it, and a rasterised result with 45k red and 51k white pixels for the Japanese flag.

#### Changing one country's flag

Select a country in Flags mode and the inspector gains a **Change Flag** picker —
the same searchable, type-a-name control World Domination uses. Pick Japan while
Romania is selected and Romania flies the Japanese flag; Japan, France and everyone
else keep their own.

What is stored is **which country's flag to borrow, not which file**. `overrides` is a
`Record<CountryId, CountryId>`, so the choice resolves through the same `flagCodeFor`
every other flag goes through. That matters for the awkward cases the library already
handles: borrow from a territory that flies its parent state's flag and you land on the
parent's artwork, exactly as that territory does — a stored filename would have had to
re-derive all of that, and would drift the first time the manifest changed.

Resolution happens in **one place**. `MapCanvas` has a single `flagCodeOf(id)` that
consults the overrides before falling back to the country's own code, and both
`buildFlagTiles` and `buildFlagIslands` are handed it instead of a bare `flagCodeFor`.
Everything downstream follows for free: the maritime codes derive from the tiles, and
the island floor paints from `url(#map-flag-<id>)` — the country's *own* pattern, whose
image href is now the borrowed one — so a scattered archipelago borrows a flag across
all of its islands without the island layer knowing overrides exist. Verified on Turks
and Caicos: 216 island paths still drawn, the country's pattern carrying Japan's
artwork.

Nothing is written to the flag data. `geo.meta.ROU.iso2` is still `RO` and
`flagCodeFor('ROU', 'RO')` still returns `ro` with an override in force; **Use default
flag** deletes the entry rather than writing a default back, so a reset country is
indistinguishable from one that was never changed. The picker offers only countries
whose artwork exists, since borrowing from one without would leave the country with no
flag at all.

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

Dissolving several countries into one custom entity — an "Iberia", a "Scandinavia" —
with its own name and its own flag.

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

The dissolve is cached on dataset plus membership and runs on the **Merge** button, never
on a selection change: it walks every arc of every member, which is exactly the kind of
work that must not happen on a pointer move.

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

**The Merge button sits above the selection, not below it.** The inspector draws a row per
selected country, so with the button underneath it, selecting a dozen countries pushed the
one control the author was reaching for down the panel — and further away with every
shift-click. It is now first in the Merge panel.

That alone was not enough, because Merge is a subsection of Data and Data shows the same
inspector above it: a long selection there pushed the whole Merge block down regardless of
what Merge did internally. So the bound belongs to the *list*, not to Merge — one
`.selection-scroll` wrapper, used by both. The part that grows without limit is the part
that scrolls, and everything around it keeps its position.

Measured: with 2, 5, 10, 20 and 25 countries selected the Merge button stayed at exactly
the same offset and stayed on screen every time; before, it moved 652 -> 1912px. Nothing
else changed — merging 25 countries still produces one entity with 25 members drawn on the
map, and the name field, flag selector and member list are all where they were. In Flags
mode the Change Flag control is deliberately outside the scrolled list, so it cannot
scroll away from the selection it acts on.

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
projection, palette mode, theme and toggle: 100% match, with the only apparent
mismatch turning out to be a magnifier lens that `elementFromPoint` cannot see
because its group is `pointer-events: none`. The magnifier *is* exported — it is
visibly part of the map — while the interaction infrastructure underneath it is not.

### Undo

Undo is a stack of `MapDocument` snapshots, not inverse operations. The executor
already returns a new document and never mutates the old one, so the previous state is
simply the value that was there a moment ago — and because every unchanged branch is
shared by reference, keeping it costs the few objects the edit actually replaced.
Inverses would mean writing and maintaining an undo for every operation in the
vocabulary, and getting one of them subtly wrong is how undo stacks start lying.

Only content operations make a step (`UNDOABLE_OPERATIONS` in `state/operations.ts`).
Changing the region, the projection or the style recomposes the view rather than
editing the map, and putting those on the same stack would mean Ctrl+Z sometimes moves
the camera and sometimes changes the data — the fastest way to make an undo button
untrustworthy. A rejected operation changes nothing and costs no step.

Edits sharing a `coalesceKey` and arriving within 700 ms extend the step already on the
stack rather than adding to it, so typing "1200" into a value field is one undo, not
four. Shortcuts are Ctrl+Z, and Ctrl+Shift+Z or Ctrl+Y to redo; they are bound on the
window and fire even inside a text field, because every field here writes through an
operation and undo reverses what was typed anyway.

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
