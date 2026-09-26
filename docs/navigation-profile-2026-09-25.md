# 10m navigation investigation — 2026-09-25

## Outcome

Investigation complete for the primary stress case; the requested smooth-navigation fix is **not complete**. None of the tested alternatives meets the quality and responsiveness requirements. No experimental renderer or navigation change is retained. The three pre-existing source changes were restored byte-for-byte to their starting snapshots, preserving the user's work.

The evidence supports investigating retained GPU vector geometry next. It does not establish that all possible SVG optimizations are exhausted, and it does not establish that a WebGL implementation will meet feature parity or 60 FPS.

## Setup and reproducibility

Production Vite build with `VITE_BRIDGE=1`, isolated headless Microsoft Edge, GPU enabled through ANGLE Direct3D11, desktop 1280 × 800 at DPR 1. Primary dataset: Europe Administrative / europe-admin-detailed, 3,022 entities, initial camera scale 1.4, sidebar explicitly open with `blur(10px) saturate(1.1)`.

The baseline is the working tree supplied at the start of this investigation, **not a clean Git commit**. It includes the pending MapCanvas, pathChunks, and waterDetail changes. In particular, its water tolerance can follow the existing land tolerance. It is therefore not a validated full-detail reference for visual equivalence. A separate candidate forced water tolerance to zero.

Run a production preview built with the bridge, then in PowerShell:

```powershell
$env:URL='http://localhost:4191/'
$env:CASE='europe-admin-detailed'
$env:K='1.4'
$env:SIDEBAR='open'
$env:GEST='mouse-pan,wheel-zoom,alternating'
$env:TRACE_PREFIX='.cache/nav-baseline-open'
$env:OUT='.cache/nav-baseline-open.txt'
$env:TOP='10'
node scripts/profile-navigation.mjs
```

The harness dispatches real browser-protocol input, observes DOM mutations and React commits, and records Chrome trace events. It uses a separate temporary browser profile. `INJECT_CSS` and `INJECT_JS` allow temporary diagnostic variants without editing the product.

Raw baseline traces remain locally in `.cache/nav-baseline-open-{mouse-pan,wheel-zoom,alternating}.json`. Diagnostic output files are listed below. These cache artifacts are not committed.

## Baseline measurements

| Gesture | Mean rAF gap | Median | p95 | Maximum | Main-thread task total | GPU-process task total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mouse pan | 4 ms | 4 ms | 4 ms | 8 ms | 215 ms | 11 ms |
| Wheel zoom in/out | 9 ms | 4 ms | 42 ms | 58 ms | 131 ms | 1,083 ms |
| Rapid alternating zoom/pan | 15 ms | 4 ms | 67 ms | 96 ms | 346 ms | 2,415 ms |

**Measurement limits:** rAF gaps include callbacks with no changed map frame; their mean must not be converted into visible FPS. They are not GPU presentation times or end-to-end input latency. Trace totals cover the gesture plus settling and can overlap across threads and nested categories. GPU task duration includes waiting; it is not pure GPU execution time. The original alternating run's printed `ideal:1920` was a harness metadata error; its nominal input pacing was 960 ms. The script now uses the correct pacing metadata. Do not derive a backlog ratio from the original `ideal` field.

For wheel zoom, the GPU thread spent approximately 600 ms in `DoRasterCHROMIUM` and 471 ms in raster flush work. Alternating navigation recorded approximately 1,251 ms in `DoRasterCHROMIUM` and 1,119 ms in flush work. These nested durations are not additive to task totals.

## What navigation does

Source inspection and observed mutations agree that the existing camera pipeline already avoids the proposed React/reprojection loop:

- D3 updates a live camera ref; one pending animation frame applies the newest camera.
- The geographic parent group receives a transform. Scaling also changes the inherited stroke-scale CSS property.
- Persistent camera state is committed at gesture end. Counts below include that settlement.
- The pan run recorded 61 transform and two style mutations, one React commit, and one store camera change.
- The zoom run recorded 25 transform and 28 style mutations, two React commits, and one store camera change.
- Neither run recorded SVG `d` changes or child-list rebuilding.
- There was no sampled difference between D3's desired camera and the applied SVG camera after animation-frame callbacks. This rules out an observed application-side transform backlog in these runs, not browser/GPU latency.

Thus geography/path regeneration, rebuilding hit targets, and thousands of per-entity DOM writes are not the demonstrated primary bottleneck. Borders and water remain expensive to **rasterize**, even when their geometry strings stay unchanged. Changing scale invalidates the sharp vector rendering and scale-compensated strokes. Constant-scale pan can reuse the existing compositor surface much more effectively.

There is no evidence here warranting a refactor of merge computation, projections, sidebar state, flags, or overlay data. This run does not individually instrument every such subsystem, and their feature-heavy configurations still need regression coverage.

## Isolation and unsuccessful alternatives

| Temporary variant | Pan mean / p95 rAF gap | Zoom mean / p95 rAF gap | Alternating mean / p95 rAF gap |
| --- | ---: | ---: | ---: |
| Baseline | 4 / 4 ms | 9 / 42 ms | 15 / 67 ms |
| Native non-scaling strokes | 5 / 21 ms | 27 / 96 ms | 28 / 104 ms |
| Sidebar blur disabled | 8 / 37 ms | 18 / 63 ms | 42 / 246 ms |
| Full water points, smaller 8k-character batches | 9 / 37 ms | 29 / 117 ms | 64 / 408 ms |
| Retained Canvas Path2D diagnostic | 104 / 133 ms | 18 / 75 ms | 83 / 162 ms |

These single-run diagnostic comparisons are noisy, not controlled statistical estimates. None establishes a shippable improvement. In particular, disabling blur did not demonstrate a reliable benefit, so the glass appearance was preserved.

Diagnostic outputs: `.cache/nav-native-stroke.txt`, `.cache/nav-no-blur.txt`, `.cache/nav-exact-chunks.txt`, `.cache/nav-canvas-diagnostic.txt`.

An additional isolated 40-frame transform test measured a 154.7 ms average update interval for the complete map under continuous scale changes, 118.3 ms with lakes hidden, and 95.4 ms with line layers hidden. With only country fills it measured 4.6 ms. Hiding layers was diagnostic only. This isolates substantial cost in the stroked networks and water. However, this test retained compositor promotion during scaling, unlike the real navigation pipeline; its country-only result is **not** proof of sharp zoom quality. Its sidebar was actually closed, so its backdrop variant is excluded from conclusions about sidebar cost.

The Canvas prototype cached the same `Path2D` geometry and redrew it at each camera transform. It failed to solve raster cost and made pan much worse. It was deliberately incomplete: clips, patterns, exports, and full feature parity were not implemented or validated. It is not a candidate product renderer.

## Proposed next architecture experiment

### Follow-up timing validation — 2026-09-26

Two short runs against the saved baseline validated the new camera-mutation timing counters. Wheel input at 50 ms pacing produced 24 camera changes with a 51 ms mean gap and 71 ms p95. This mainly reflects the input cadence, not rendering cost.

A trackpad-style sequence requesting 120 updates at 8 ms pacing took 7,220 ms rather than the nominal 960 ms. It produced 120 camera changes, averaging 61 ms apart (79 ms p95), while idle-inclusive rAF gaps averaged only 29 ms. GPU-process tasks totaled 7,332 ms including settling. No SVG path mutations were recorded. These results further show why idle rAF averages are insufficient.

The driver awaits each browser-protocol dispatch, so this measures browser/driver backpressure as well as rendering. It is not proof that physical trackpad events queue identically, nor an end-to-end latency measurement. Output is saved in `.cache/nav-camera-timing.txt`.

The profiler also now separates React commits during input playback from commits during settling; that addition passed syntax validation but has not yet been exercised in a browser run. No product code changed in this follow-up.

### Retained-vector proposal

Prototype retained GPU vector meshes for the expensive static border/water layers in isolation. Tessellate projected geometry when the geometry or projection changes, retain the buffers, and update camera uniforms during navigation. Keep the full geographic coordinates, holes, ordering, stroke widths, joins, and antialiasing. A simple Canvas redraw or scaled bitmap is not sufficient.

Before integrating it, require pixel comparisons against full-detail SVG at multiple scales/projections and a measured improvement in presented-frame intervals and input latency. Reject the approach if exact feature behavior or acceptable visual equivalence cannot be maintained. Existing SVG can remain the export reference, but export parity must be tested rather than assumed.

No new renderer has been implemented. There are consequently no successful "after" measurements and no claim that mobile, selection, Rectangle, Brush, Merge, Compare, Data, Flags, overlays, labels, or export regressions passed. The complete requested map/mode/projection matrix remains outstanding. The remaining demonstrated bottleneck in the primary case is SVG raster/paint and GPU-process work during scale changes, rather than React camera updates.
