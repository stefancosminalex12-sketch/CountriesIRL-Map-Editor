# Desktop pan investigation

Baseline: `39d7bdc` (2026-09-25). Production Vite builds with the existing development bridge enabled, isolated headless Edge, real CDP mouse/touch input, 1280 x 800 desktop at DPR 1. GPU reported NVIDIA GeForce RTX 4060 Laptop GPU / Direct3D 11. No CPU throttling. Measurements below are local observations, not a hardware-independent FPS promise.

## Finding and change

The map already coalesces input into one latest camera per animation frame, writes a single SVG group transform, and commits the camera to Zustand only when navigation ends. Reprojection and React rendering were not the desktop pan bottleneck.

The expensive discontinuity was compositor layer creation at the first movement past the click tolerance, followed by disposal 120 ms after release. Europe Administrative's baseline trace spent about 1.4 seconds in renderer Commit work for a nominal one-second pan. Keeping the existing camera layer prepared at rest removed that startup cost. Only this group receives the hint; no geographic layer, data cache, or selection system was refactored.

Fine-pointer devices now prepare the camera layer at rest and retain it between pans. Actual zooms still drop promotion, including programmatic scale changes and resize corrections, so they render at the real scale. The idle timer prepares the layer; it never delays input. The pre-existing latest-camera rAF, click tolerances, exact geometry, selection rules, D3 bounds, stroke widths, and pan pixel alignment remain unchanged. Coarse-pointer devices retain the previous pan-layer lifetime.

## What executes during input

1. D3's window mousemove listener converts the pointer through the SVG screen matrix, computes the constrained camera, and emits one zoom event. Its matrix read can flush pending layout; measured layout was a small fraction of the stalls.
2. The handler checks movement tolerance, updates navigation/compositor refs, replaces the pending camera, and requests a frame only if none is queued. There is no queue of old positions and no throttling timer on movement.
3. The frame writes the zoom group's transform. During translation the scale custom property does not change. Enabled small-entity magnifiers follow the camera imperatively.
4. Release flushes the last pending camera and commits it once. Hover/hit testing resumes after the existing 120 ms protection interval.

| Investigated system | Result during active pan |
| --- | --- |
| Geographic paths, projection, borders, coastlines, rivers, lakes | Stable memoized geometry; no `d` mutations in the matrix |
| Merged entities, Water Regions, overlay source geometry | Stable; included in populated-mode cases |
| Labels and flag textures | No layout/pattern rebuild; carried by the same camera |
| Selection/highlight layers | No selection mutation or rebuilding; existing browser paint/raster work remains |
| Hit targets | Not rebuilt; existing navigation guard suppresses land pointer events |
| React, Zustand, sidebar | Zero camera store changes during the measured gesture; final release commits once |
| Event listeners | D3 owns navigation. Selection-tool pointer listeners return immediately without an active selection gesture; no duplicate D3 drag installation found |
| Allocations/DOM | Small D3 camera/point allocations plus one group transform write per visual update; no feature-sized allocations or DOM traversal in the pan handler |
| Style/layout/compositing | Layer allocation and GPU/raster/commit work dominated the large stalls, not geometry or React |

## Before / after measurements

Each slow test sends 60 movements over 960 ms. Values are **baseline / candidate**, in milliseconds. Wall time includes input delivery and completion. Frame gaps are requestAnimationFrame timestamp gaps during the gesture, not a claim about physical monitor presentation. The browser supplied roughly 4.2 ms rAF intervals; rendering/input can still stall between those intervals.

| Case | Drag wall time | Frame-gap p95 | Largest frame gap |
| --- | ---: | ---: | ---: |
| world-10m | 1000 / 998 | 4.3 / 4.3 | 262.5 / 20.8 |
| world-50m | 1006 / 1007 | 4.3 / 4.3 | 54.1 / 9.6 |
| europe-admin | 2146 / 1008 | 79.2 / 4.3 | 1175.0 / 37.5 |
| europe-countries | 1656 / 994 | 54.2 / 4.3 | 387.5 / 29.1 |
| admin-world | 1612 / 1005 | 52.9 / 4.3 | 474.0 / 35.8 |
| usa-admin | 1005 / 1000 | 25.0 / 4.3 | 229.2 / 29.2 |
| data-layers | 1496 / 1228 | 41.6 / 37.6 | 612.5 / 41.7 |
| compare-layers | 6475 / 2889 | 108.3 / 83.3 | 1620.8 / 87.5 |
| flags-layers | 1656 / 1802 | 41.7 / 37.7 | 283.3 / 41.8 |

All 60 matrix gestures had zero active-pan store changes and no geographic path mutations. Cases include World 10m/50m, Europe Administrative (3,022 paths), Europe Countries, Administrative World (4,030 paths), USA counties (3,235 paths), default/auto projections plus Mercator and equirectangular, and several camera scales. Populated modes include 120 selected entities, enabled labels, rivers/coasts/lakes, Water Regions, an overlay, and a merge. Data values, Compare memberships, and Flags are populated through the real operation pipeline.

### Limits observed

Fast tests send 60 positions at 4 ms spacing, sweeping 300 pixels and back, with wheel zooms between runs. Retaining the layer removes its allocation hitch, but revealing new areas of highly detailed maps still causes substantial raster/commit work. This change does **not** guarantee smooth frames in every dense, fully enabled configuration. For example, the loaded Compare case still took 2.89 s for the slow drag (down from 6.48 s); one fast post-zoom pass took 10.56 s versus 9.24 s at baseline. Fast-pass results vary with tile residency and GPU work. No steadily increasing cost was established by the repeated cycles, but the severe residual raster spikes are real.

Replacing the SVG transform with CSS 2D/3D transforms was also tested diagnostically. It did not remove those raster spikes, so it was not shipped. No reduced-detail geometry, hidden labels/features, temporary bitmap, or zoomed low-resolution substitute was introduced.

### Visual checks

Stationary screenshots were compared at identical cameras. Geometry and content match. Compositing changes browser antialiasing slightly, so desktop screenshots are not byte-identical: for the World 50m map interior, differences were at most 3/255 per color channel; Europe Administrative had one sampled interior pixel above 16/255. Browser text antialiasing in screen-space controls also changes with layer promotion. Populated Data/Compare captures had no pixel differences above 16/255. Mobile stationary captures were pixel-identical. These are rendering differences, not changes to geographic detail or authored appearance; screenshot inspection is part of validation, rather than an assertion of byte-identical desktop output.

## Reproduction

Build the baseline and candidate separately with `VITE_BRIDGE=1`, serve them on two local ports using `vite preview`, then run:

```powershell
$env:BASE='http://localhost:4187'
$env:CANDIDATE='http://localhost:4188'
node scripts/profile-pan.mjs
```

The harness creates an isolated temporary Edge profile and saves `.cache/pan-results.json` and screenshots in `.cache/pan-checks/`. It uses no personal browser data. `EDGE` overrides the browser executable. `CASES` selects comma-separated case names, `BUILD` selects `base` or `candidate`, `CYCLES` controls repeated zoom/pan cycles, and `OUT` selects the result file. It records trace categories, camera reconciliation, SVG mutations, React commits, store changes, and checks real post-drag entity click/tap selection. Mobile input uses CDP touch/pinch emulation; physical-device testing is still useful.

## Final regression checks

A separate production-build run instrumented React commits and repeated 18 navigation gestures across Europe Administrative, populated Data mode, and mobile emulation. Every active pan had zero React commits, zero camera store changes, and zero path mutations. D3 and the store reconciled on release, hit testing was restored, and real desktop clicks/mobile taps selected the expected visible entity after navigation. Touch tests included one-finger panning and repeated two-finger pinches to 5.4x and 9.72x.

During-drag screenshots at matching desktop cameras differed by only 2 pixels for Europe Administrative and 178 pixels for populated Data mode, all at or below 16/255 channel difference. The final paced-touch check matched the actual camera in both builds (3x, x=-560, y=-330): mobile screenshots were pixel-identical both at rest and during panning (2,962,440 pixels each), and tap selection passed. A first one-move synthetic touch screenshot was not camera-stable; the harness now paces that gesture and reports its actual camera.

`npm run typecheck`, `npm run build`, and `git diff --check` passed. Vite reported its existing large-bundle advisory; no new build errors were introduced.
