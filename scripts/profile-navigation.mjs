// Navigation with real input (DevTools protocol mouse, wheel, ctrl-wheel pinch, touch) in headless
// Edge on the real GPU, one row per gesture:
//   wall/ideal  how long the input took to play out against its own pacing (backlog if >> 1)
//   frames, mean/p50/p95/max rAF callback gaps (includes frames without visual changes).
//               These are NOT GPU presentation times or achieved visible FPS.
//   cameraUpdates/cameraGapMean/cameraGapP95: actual camera-transform mutation timing.
//               Excludes idle rAF callbacks; includes input pacing, not GPU presentation.
//   lagMax      the largest gap, at any frame, between the camera d3 has reached and the one drawn
//   commits     React commits including 600ms settle; muts: DOM mutations by attribute; stores: camera
//               writes to the store during the gesture
//   inputCommits/settleCommits separate input playback from the final settling window.
//   main/style/paint/raster/gpu  inclusive trace totals (ms); categories can overlap.
//               GPU task duration includes waits, not just GPU execution.
//
//   URL=http://localhost:4173/ CASE=europe-admin-detailed PROFILE=desktop GEST=all node scripts/profile-navigation.mjs
// Setup knobs: SIDEBAR=open, MODE=data|compare|flags, SELECT=<n>, LABELS=1, LAYERS=rivers,waters,graticule,
// K=<camera scale to start from>, INJECT_CSS=<css>, REPEAT=<n>
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = Number(process.env.PORT_CDP ?? 9420)
const URL = process.env.URL ?? 'http://localhost:4173/'
const CASES = {
  'world-110m': ['world', 'modern-110m'], 'world-50m': ['world', 'modern-50m'], 'world-10m': ['world', 'modern-10m'],
  'admin-world': ['admin-world', 'admin-curated'], 'admin-world-detailed': ['admin-world', 'admin-detailed'],
  'europe-countries': ['europe-countries', 'europe-countries-full'],
  'europe-admin': ['europe-admin', 'europe-admin-standard'], 'europe-admin-detailed': ['europe-admin', 'europe-admin-detailed'],
  'usa-states': ['usa-states', 'usa-states-10m'], 'usa-admin': ['usa-official', 'usa-official-counties'],
}
const CASE = process.env.CASE ?? 'europe-admin-detailed'
const [ATLAS, DATASET] = CASES[CASE]
const PROFILES = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, cpu: 1, touch: false },
  macbook: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, cpu: 1, touch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, cpu: 4, touch: true },
  landscape: { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, cpu: 4, touch: true },
}
const P = PROFILES[process.env.PROFILE ?? 'desktop']
const GESTURES = (process.env.GEST ?? 'all').split(',')
const REPEAT = Number(process.env.REPEAT ?? 1)
const OUT = process.env.OUT
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profileDir = mkdtempSync(join(tmpdir(), 'edge-real-'))
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', `--window-size=${P.width},${P.height}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => edge.kill())
let wsUrl
for (let i = 0; i < 100 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(100) } }
if (!wsUrl) throw new Error('Edge did not start')
const ws = new WebSocket(wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const pending = new Map()
const listeners = new Set()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.method === 'Inspector.targetCrashed') throw new Error('Profiled browser renderer crashed')
  if (msg.method === 'Runtime.exceptionThrown') console.error('Browser exception:', msg.params.exceptionDetails)
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result) } else for (const l of listeners) l(msg)
}
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (method, params) => send(method, params, sessionId)
const once = (method) => new Promise((r) => { const l = (m) => { if (m.method === method && m.sessionId === sessionId) { listeners.delete(l); r(m.params) } }; listeners.add(l) })
const evaluate = async (expression) => {
  const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
await S('Page.enable')
await S('Runtime.enable')
await S('Inspector.enable')
await S('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__reactCommits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1, onCommitFiberRoot: () => window.__reactCommits++, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {} };
` })
await S('Emulation.setDeviceMetricsOverride', { width: P.width, height: P.height, deviceScaleFactor: P.deviceScaleFactor, mobile: P.mobile })
await S('Emulation.setTouchEmulationEnabled', { enabled: P.touch, maxTouchPoints: P.touch ? 5 : 1 })
const loaded = once('Page.loadEventFired')
await S('Page.navigate', { url: URL })
await loaded
const setupOpts = { atlas: ATLAS, dataset: DATASET, mode: process.env.MODE ?? '', select: Number(process.env.SELECT ?? 0), labels: !!process.env.LABELS, layers: (process.env.LAYERS ?? '').split(',').filter(Boolean), sidebar: process.env.SIDEBAR ?? 'closed', k: Number(process.env.K ?? 0) }
const setup = await evaluate(`(async () => {
  const o = ${JSON.stringify(setupOpts)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (f, t = 300000) => { const t0 = performance.now(); while (!f()) { if (performance.now() - t0 > t) throw new Error('timeout'); await sleep(150) } }
  await until(() => window.__mapEditor && window.__mapEditor.getState().geoStatus === 'ready')
  const api = window.__mapEditor
  if (api.getState().doc.scope.atlasId !== o.atlas) api.setAtlas(o.atlas)
  await until(() => api.getState().doc.scope.atlasId === o.atlas)
  if (api.getState().doc.scope.datasetId !== o.dataset) api.dispatch({ op: 'set_scope_dataset', datasetId: o.dataset })
  await until(() => api.getState().geoStatus === 'ready' && api.getState().geo?.dataset.id === o.dataset)
  const count = () => document.querySelectorAll('[data-country-id]').length
  let last = -1
  while (last !== count()) { last = count(); await sleep(1500) }
  const ids = api.getState().geo.features.map((f) => f.properties.countryId)
  const ops = []
  if (o.labels) ops.push({ op: 'set_labels', patch: { enabled: true } })
  const layerPatch = {}
  for (const l of o.layers) layerPatch[{ rivers: 'showRivers', waters: 'showWaterRegions', graticule: 'showGraticule', lakes: 'showLakes', coast: 'showCoastlines', borders: 'showBorders' }[l.replace(/^-/, '')]] = !l.startsWith('-')
  if (Object.keys(layerPatch).length) ops.push({ op: 'set_style', patch: layerPatch })
  if (o.mode === 'flags') ops.push({ op: 'set_flags', patch: { enabled: true } })
  else if (o.mode === 'compare') ops.push({ op: 'set_comparison', patch: { enabled: true } }, { op: 'add_to_comparison', index: 0, countryIds: ids.slice(0, Math.min(400, ids.length / 3 | 0)) }, { op: 'add_to_comparison', index: 1, countryIds: ids.slice(Math.min(400, ids.length / 3 | 0), Math.min(800, (2 * ids.length) / 3 | 0)) })
  else if (o.mode === 'data') for (let i = 0; i < Math.min(ids.length, 1500); i++) ops.push({ op: 'set_country_value', countryId: ids[i], value: i % 97 })
  if (ops.length) { const r = api.dispatch(ops); if (r && r.ok === false) throw new Error(JSON.stringify(r)); await sleep(3000) }
  if (o.mode === 'data') { const layer = api.getState().doc.layers[0]; api.dispatch({ op: 'set_layer', layerId: layer.id, patch: { colorScale: { ...layer.colorScale, mode: 'numeric' } } }); await sleep(2000) }
  if (o.select) { api.getState().addToSelection(ids.slice(0, o.select)); await sleep(2000) }
  if (o.sidebar !== 'open') document.querySelector('[aria-label="Collapse panel"]')?.click()
  else { const b = document.querySelector('.sidebar__rail button[aria-expanded="false"]'); if (!document.querySelector('.sidebar__body') && b) b.click() }
  await sleep(2500)
  if (o.k) {
    const svg = document.querySelector('#map-canvas-svg'), b = svg.getBoundingClientRect()
    const t = { k: o.k, x: Math.round(-b.width * (o.k - 1) / 2), y: Math.round(-b.height * (o.k - 1) / 2) }
    api.getState().setTransform(t); Object.assign(svg.__zoom, t)
    await sleep(2500)
  }
  return { units: count(), mode: o.mode, selected: api.getState().selectedCountryIds.length, labels: document.querySelectorAll('#map-canvas-svg text').length, sidebarOpen: !!document.querySelector('.sidebar__body'), backdrop: getComputedStyle(document.querySelector('.sidebar__body') ?? document.body).backdropFilter }
})()`)
const header = `${CASE} ${process.env.PROFILE ?? 'desktop'} ${JSON.stringify(setup)} ${process.env.INJECT_CSS ? 'css=' + process.env.INJECT_CSS : ''}`
console.log(header)
if (process.env.INJECT_CSS) await evaluate(`(() => { const s = document.head.appendChild(document.createElement('style')); s.textContent = ${JSON.stringify(process.env.INJECT_CSS)} })()`)
await sleep(1000)

// The map's centre, or the nearest point to it where the map itself is under the pointer (an
// open panel covers most of a phone's screen), with room around it for the gesture.
const centre = () => evaluate(`(() => {
  const svg = document.querySelector('#map-canvas-svg'), b = svg.getBoundingClientRect()
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  const onMap = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && svg.contains(e) }
  if (onMap(cx, cy)) return [Math.round(cx), Math.round(cy)]
  let best = null
  for (let y = b.y + 20; y < b.bottom - 20; y += 10) for (let x = b.x + 20; x < b.right - 20; x += 10) {
    if (!onMap(x, y)) continue
    const d = (x - cx) ** 2 + (y - cy) ** 2
    if (!best || d < best[2]) best = [Math.round(x), Math.round(y), d]
  }
  return best ? [best[0], best[1]] : [Math.round(cx), Math.round(cy)]
})()`)
const mouse = (type, x, y, extra = {}) => S('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
const wheel = (x, y, deltaY, ctrl = false, deltaX = 0) => S('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: ctrl ? 2 : 0 })
const touch = (type, points) => S('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
async function paced(steps, every, fn) {
  const t0 = performance.now()
  for (let i = 0; i < steps; i++) {
    const wait = t0 + i * every - performance.now()
    if (wait > 0) await sleep(wait)
    await fn(i)
  }
  return performance.now() - t0
}
const GESTURES_DEF = {
  // A mouse drag across and back, 60 moves at 60 Hz.
  'alternating': { pace:8,steps:120,run:async([x,y])=>{const t=performance.now();for(let j=0;j<4;j++){await paced(8,8,()=>wheel(x,y,j%2?35:-35));await mouse('mousePressed',x,y,{clickCount:1,buttons:1});await paced(22,8,i=>mouse('mouseMoved',x+Math.sin(i/21*Math.PI)*100,y+Math.sin(i/21*Math.PI)*50,{buttons:1}));await mouse('mouseReleased',x,y,{clickCount:1})}return performance.now()-t}},
  'mouse-pan': { pace: 16, steps: 60, run: async ([x, y]) => { await mouse('mousePressed', x, y, { clickCount: 1, buttons: 1 }); const w = await paced(60, 16, (i) => { const d = i < 30 ? i : 60 - i; return mouse('mouseMoved', x + d * 9, y + d * 5, { buttons: 1 }) }); await mouse('mouseReleased', x, y, { clickCount: 1 }); return w } },
  // Mouse-wheel notches in then out, one every 50 ms (a quick spin of a notched wheel).
  'wheel-zoom': { pace: 50, steps: 24, run: async ([x, y]) => paced(24, 50, (i) => wheel(x, y, i < 12 ? -100 : 100)) },
  // A trackpad pinch: ctrl-wheel at 120 Hz, in then out.
  'trackpad-pinch': { pace: 8, steps: 120, run: async ([x, y]) => paced(120, 8, (i) => wheel(x, y, i < 60 ? -4 : 4, true)) },
  // A trackpad two-finger scroll: plain wheel at 120 Hz with small deltas (d3 zooms on it).
  'trackpad-scroll': { pace: 8, steps: 120, run: async ([x, y]) => paced(120, 8, (i) => wheel(x, y, i < 60 ? -6 : 6, false, 2)) },
  // A notched wheel turned one click at a time: every notch is a gesture of its own (d3 ends one
  // 150 ms after its last wheel event), so each commits and the next starts from rest.
  'wheel-notches': { pace: 260, steps: 10, run: async ([x, y]) => paced(10, 260, (i) => wheel(x, y, i < 5 ? -100 : 100)) },
  // Three notches, then a drag straight after: what a pan costs right after zooming.
  'notch-then-pan': { pace: 16, steps: 94, run: async ([x, y]) => { const a = await paced(3, 260, () => wheel(x, y, -100)); await sleep(220); await mouse('mousePressed', x, y, { clickCount: 1, buttons: 1 }); const b = await paced(60, 16, (i) => { const d = i < 30 ? i : 60 - i; return mouse('mouseMoved', x + d * 9, y + d * 5, { buttons: 1 }) }); await mouse('mouseReleased', x, y, { clickCount: 1 }); return a + 220 + b } },
  'touch-pan': { pace: 16, steps: 60, touch: true, run: async ([x, y]) => { await touch('touchStart', [[x, y]]); const w = await paced(60, 16, (i) => { const d = i < 30 ? i : 60 - i; return touch('touchMove', [[x + d * 5, y + d * 4]]) }); await touch('touchEnd', []); return w } },
  'touch-pinch': { pace: 16, steps: 60, touch: true, run: async ([x, y]) => { await touch('touchStart', [[x - 30, y], [x + 30, y]]); const w = await paced(60, 16, (i) => { const d = (i < 30 ? i : 60 - i) * 3; return touch('touchMove', [[x - 30 - d, y - d / 3], [x + 30 + d, y + d / 3]]) }); await touch('touchEnd', []); return w } },
}

async function measure(name) {
  const def = GESTURES_DEF[name]
  const at = await centre()
  await evaluate(`(() => {
    const svg = document.querySelector('#map-canvas-svg'), g = svg.querySelector('g[style*="--map-k"]')
    const r = window.__nav = { on: true, frames: [], cameraUpdates: [], lag: [], commits: window.__reactCommits, muts: {}, stores: 0 }
    let lastCameraTransform = g.getAttribute('transform')
    r.mo = new MutationObserver((rs) => {
      for (const m of rs) { const k = m.type === 'attributes' ? m.attributeName : m.type; r.muts[k] = (r.muts[k] || 0) + 1 }
      if (rs.some((m) => m.target === g && m.attributeName === 'transform')) {
        const current = g.getAttribute('transform')
        if (current !== lastCameraTransform) { r.cameraUpdates.push(performance.now()); lastCameraTransform = current }
      }
    })
    r.mo.observe(document.querySelector('.map-canvas') ?? svg, { subtree: true, attributes: true, childList: true, characterData: true })
    let prev = window.__mapEditor.getState().transform
    r.unsub = null
    r.ch = new MessageChannel()
    r.ch.port1.onmessage = () => { const want = svg.__zoom, have = read(); if (want && have) r.lag.push(Math.max(Math.abs(want.x - have.x), Math.abs(want.y - have.y), Math.abs(Math.log2(want.k / have.k)) * 1000)) }
    const read = () => { const m = (g.getAttribute('transform') || '').match(/translate\\(([^,]+),([^)]+)\\) scale\\(([^)]+)\\)/); return m ? { x: +m[1], y: +m[2], k: +m[3] } : null }
    const loop = (t) => {
      if (!r.on) return
      r.frames.push(t)
      // After this frame's callbacks (the app's camera placement among them) have run.
      r.ch.port2.postMessage(0)
      const now = window.__mapEditor.getState().transform
      if (now !== prev) { r.stores++; prev = now }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })()`)
  const events = []
  const onData = (m) => { if (m.method === 'Tracing.dataCollected') events.push(...m.params.value) }
  listeners.add(onData)
  await S('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,toplevel,gpu,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
  await sleep(100)
  const t0 = await evaluate('performance.now()')
  const w = await def.run(at)
  const inputEnd = await evaluate('({ time: performance.now(), commits: window.__reactCommits - window.__nav.commits })')
  const t1 = inputEnd.time
  // How long until the drawn camera is the final one and the map is still.
  const settle = await evaluate(`(async () => { const t = performance.now(); const r = window.__nav; for (let i = 0; i < 400; i++) { await new Promise((q) => requestAnimationFrame(q)); if ((r.lag.at(-1) ?? 0) < 0.5 && performance.now() - t > 40) break } return performance.now() - t })()`)
  await sleep(600)
  const rec = await evaluate(`(() => { const r = window.__nav; r.on = false; r.mo.disconnect(); r.ch.port1.close(); r.ch.port2.close(); return { frames: r.frames, cameraUpdates: r.cameraUpdates, lag: r.lag, commits: window.__reactCommits - r.commits, muts: r.muts, stores: r.stores } })()`)
  const done = once('Tracing.tracingComplete')
  await S('Tracing.end')
  await done
  listeners.delete(onData)
  if(process.env.TRACE_PREFIX)writeFileSync(process.env.TRACE_PREFIX+'-'+name+'.json',JSON.stringify({traceEvents:events}))
  const inGesture = rec.frames.filter((t) => t >= t0 && t <= t1 + 50)
  const cameraUpdates = rec.cameraUpdates.filter((t) => t >= t0 && t <= t1 + 50)
  const cameraGaps = cameraUpdates.slice(1).map((t, i) => t - cameraUpdates[i]).sort((a, b) => a - b)
  const gaps = inGesture.slice(1).map((t, i) => t - inGesture[i]).sort((a, b) => a - b)
  const pct = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : NaN)
  const threads = new Map()
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name)
  let main = 0, style = 0, paint = 0, raster = 0, gpu = 0, script = 0, hit = 0
  for (const e of events) {
    if (e.ph !== 'X') continue
    const tn = threads.get(`${e.pid}:${e.tid}`) ?? '', d = (e.dur ?? 0) / 1000
    if (tn === 'CrRendererMain') {
      if (e.name === 'RunTask') main += d
      if (e.name === 'UpdateLayoutTree' || e.name === 'Layout') style += d
      if (['Paint', 'PrePaint', 'Commit', 'Layerize'].includes(e.name)) paint += d
      if (['EventDispatch', 'FunctionCall', 'TimerFire', 'FireAnimationFrame'].includes(e.name)) script += d
      if (e.name === 'HitTest') hit += d
    }
    if (e.name === 'RasterTask') raster += d
    if (tn === 'CrGpuMain' && e.name === 'GPUTask') gpu += d
  }
  if (process.env.TOP) {
    const per = new Map()
    for (const e of events) { if (e.ph !== 'X') continue; const tn = threads.get(`${e.pid}:${e.tid}`) ?? '?'; if (/RunTask|ThreadController|ThreadPool_RunTask|GpuChannel|CommandBuffer|RendererRasterWorker|GPUTask/.test(e.name)) continue; const k = tn.replace(/\d+$/, '') + ' | ' + e.name; per.set(k, (per.get(k) ?? 0) + (e.dur ?? 0) / 1000) }
    console.log('  top (' + name + '):\n    ' + [...per].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP)).map(([k, v]) => k + ' ' + Math.round(v)).join('\n    '))
  }
  const f = (v) => (Number.isFinite(v) ? Math.round(v) : '-')
  const muts = Object.entries(rec.muts).map(([k, v]) => `${k}:${v}`).join(' ')
  const commitPhases = { inputCommits: inputEnd.commits, settleCommits: rec.commits - inputEnd.commits }
  return { gesture: name, ...commitPhases, wall: f(w), ideal: def.steps * def.pace, settle: f(settle), frames: inGesture.length, mean: f(gaps.reduce((a,b)=>a+b,0)/gaps.length), p50: f(pct(0.5)), p95: f(pct(0.95)), max: f(gaps.at(-1)), cameraUpdates: cameraUpdates.length, cameraGapMean: f(cameraGaps.reduce((a,b)=>a+b,0)/cameraGaps.length), cameraGapP95: f(cameraGaps[Math.floor(cameraGaps.length * 0.95)]), lagMax: f(Math.max(0, ...rec.lag)), commits: rec.commits, stores: rec.stores, muts, main: f(main), script: f(script), style: f(style), paint: f(paint), hit: f(hit), raster: f(raster), gpu: f(gpu) }
}

if(process.env.SCREENSHOT_PREFIX) {
  const shot = await S('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.env.SCREENSHOT_PREFIX + '-before.png', Buffer.from(shot.data, 'base64'))
}
if(process.env.INJECT_JS)console.log('Diagnostic setup:', await evaluate(process.env.INJECT_JS))
if(process.env.SCREENSHOT_PREFIX) {
  const shot = await S('Page.captureScreenshot', { format: 'png' })
  writeFileSync(process.env.SCREENSHOT_PREFIX + '-after.png', Buffer.from(shot.data, 'base64'))
}
const rows = []
for (const name of Object.keys(GESTURES_DEF)) {
  if (GESTURES[0] !== 'all' && !GESTURES.includes(name)) continue
  if (!!GESTURES_DEF[name].touch !== P.touch) continue
  for (let r = 0; r < REPEAT; r++) {
    // Same starting camera for every gesture.
    await evaluate(`(async () => { const api = window.__mapEditor, svg = document.querySelector('#map-canvas-svg'), b = svg.getBoundingClientRect(), k = ${setupOpts.k || 1}; const t = { k, x: Math.round(-b.width * (k - 1) / 2), y: Math.round(-b.height * (k - 1) / 2) }; api.getState().setTransform(t); Object.assign(svg.__zoom, t); await new Promise((q) => setTimeout(q, 1500)) })()`)
    await S('Emulation.setCPUThrottlingRate', { rate: P.cpu })
    rows.push(await measure(name))
    await S('Emulation.setCPUThrottlingRate', { rate: 1 })
    await sleep(500)
  }
}
console.table(rows)
if (OUT) appendFileSync(OUT, header + '\n' + rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
await ws.close?.()
edge.kill()
await sleep(400)
if(!profileDir.startsWith(join(tmpdir(),'edge-real-')))throw Error('Unexpected temporary profile');
try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
