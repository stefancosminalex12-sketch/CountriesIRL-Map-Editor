# Retained geometry cache: focused selection check

Two production builds of the same working tree were compared on Europe Administrative
10m (3,022 entities), desktop 1280 × 800 at DPR 1, camera scale 1.4, sidebar closed.
Both enabled the experimental retained renderer and full projected water detail.
The only build difference was the CPU geometry-cache budget: zero versus 64 MiB.
Browsers ran sequentially. Each performed three select-200/clear cycles.

| Action | Cache off, mean | Cache on, mean | Reduction |
| --- | ---: | ---: | ---: |
| Select 200 | 6,437 ms | 4,537 ms | 29.5% |
| Clear selection | 5,472 ms | 4,023 ms | 26.5% |

Individual times in milliseconds:

- Off/select: 6,122, 5,706, 7,484; off/clear: 5,302, 5,218, 5,896.
- On/select: 4,796, 4,481, 4,334; on/clear: 4,037, 4,056, 3,976.

The probe measured dispatch through two animation-frame callbacks; these are update
latencies, not GPU presentation times. It excluded the 500 ms pauses between actions.
Every cycle verified the selected count and that the GPU renderer remained active.
This is a small sequential sample, not a statistical benchmark or a complete regression pass.

Caching helps, but four-second updates remain unacceptable. The next investigation is
reusing unchanged GPU batches: the current code still releases and uploads all batches
whenever the scene signature changes. This run did not separately time uploads versus
tessellation, so it does not establish which remaining stage dominates.

Local reproduction artifacts: `.cache/retained-cache-profile.config.mjs`,
`.cache/retained-selection-timing.js`, `.cache/selection-cache-off.txt`, and
`.cache/selection-cache-on.txt`. The profile config changes the cache budget only in
the test bundle, without modifying application source. The renderer remains opt-in.
