// Desktop pan trace and navigation regression harness. Requires local Edge and a VITE_BRIDGE=1 build.
// BASE=http://localhost:4187 CANDIDATE=http://localhost:4188 node scripts/profile-pan.mjs
// CASES=world-10m,europe-admin BUILD=base|candidate OUT=.cache/pan-results.json are optional.
// Test documents live only in isolated temporary browser profiles. No user browser is touched.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = Number(process.env.PORT_CDP ?? 9351)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROFILES = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, cpu: 1, touch: false },
  macbook: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, cpu: 1, touch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, cpu: 4, touch: true },
  landscape: { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, cpu: 4, touch: true },
}

const profileDir = mkdtempSync(join(tmpdir(), 'edge-perf-'))
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,800', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : []), 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => edge.kill())
let wsUrl
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(100) }
}
if (!wsUrl) throw new Error('Edge did not start')
const ws = new WebSocket(wsUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let seq = 0
const pending = new Map()
const listeners = new Set()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
  } else for (const l of listeners) l(msg)
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
await S('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__reactCommits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, inject: () => 1,
    onCommitFiberRoot: () => window.__reactCommits++,
    onCommitFiberUnmount: () => {},
  };
` })

async function applyProfile(p) {
  await S('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.deviceScaleFactor, mobile: p.mobile })
  await S('Emulation.setTouchEmulationEnabled', { enabled: p.touch, maxTouchPoints: p.touch ? 5 : 1 })
  await S('Emulation.setCPUThrottlingRate', { rate: p.cpu })
}

const builds = { base: process.env.BASE ?? 'http://localhost:4187', candidate: process.env.CANDIDATE ?? 'http://localhost:4188' }
const cases = [
  { name: 'world-10m', atlas: 'world', dataset: 'modern-10m', k: 2 },
  { name: 'world-50m', atlas: 'world', dataset: 'modern-50m', k: 5, projection: 'mercator' },
  { name: 'europe-admin', atlas: 'europe-admin', dataset: 'europe-admin-detailed', k: 5 },
  { name: 'europe-countries', atlas: 'europe-countries', dataset: 'europe-countries-full', k: 2 },
  { name: 'admin-world', atlas: 'admin-world', dataset: 'admin-detailed', k: 4 },
  { name: 'usa-admin', atlas: 'usa-official', dataset: 'usa-official-counties', k: 3 },
  { name: 'data-layers', atlas: 'world', dataset: 'modern-10m', k: 3, rich: true },
  { name: 'compare-layers', atlas: 'europe-admin', dataset: 'europe-admin-standard', k: 3, rich: true, mode: 'compare' },
  { name: 'flags-layers', atlas: 'world', dataset: 'modern-50m', k: 3, rich: true, mode: 'flags', projection: 'equirectangular' },
  { name: 'mobile', atlas: 'world', dataset: 'modern-50m', k: 3, mobile: true },
]
const errors = []
listeners.add(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text) })
const results = []
const assertions = []
const shotDir = '.cache/pan-checks'
mkdirSync(shotDir, { recursive: true })
const shot = async name => {
  const { data } = await S('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${shotDir}/${name}.png`, Buffer.from(data, 'base64'))
  return data
}
const mouse = (type, x, y) => S('Input.dispatchMouseEvent', {type, x, y, button:'left', buttons:type === 'mouseReleased' ? 0 : 1, clickCount:type === 'mouseMoved' ? 0 : 1})
const touch = (type, points) => S('Input.dispatchTouchEvent', { type, touchPoints:points.map(([x,y],id)=>({x,y,id})) })
const shots = {}
for (const c of cases.filter(c => !process.env.CASES || process.env.CASES.split(',').includes(c.name))) {
  for (const [build, url] of Object.entries(builds).filter(([b]) => !process.env.BUILD || process.env.BUILD === b)) {
    await applyProfile(c.mobile ? {...PROFILES.phone, cpu:1} : PROFILES.desktop)
    const loaded = once('Page.loadEventFired')
    await S('Page.navigate', { url }); await loaded
    const setup = await evaluate(`(async () => {
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async f=>{const end=performance.now()+180000;while(!f()){if(performance.now()>end)throw Error('load timeout');await sleep(100)}};
      await until(()=>window.__mapEditor && window.__mapEditor.getState().geoStatus==='ready');
      const api=window.__mapEditor, c=${JSON.stringify(c)};
      api.setAtlas(c.atlas); api.dispatch({op:'set_scope_dataset',datasetId:c.dataset});
      if(c.projection)api.dispatch({op:'set_scope_projection',projectionId:c.projection});
      await until(()=>api.getState().geoStatus==='ready' && api.getState().geo?.dataset.id===c.dataset);
      document.querySelector('[aria-label="Collapse panel"]')?.click();
      await sleep(2500);
      if(c.rich){
        const ids=api.getState().geo.features.map(f=>f.properties.countryId);
        api.getState().addToSelection(ids.slice(0,120));
        const ops=[{op:'set_labels',patch:{enabled:true}},{op:'set_style',patch:{showRivers:true,showCoastlines:true,showWaterRegions:true}}];
        const members=c.atlas==='world'?['ROU','BGR']:ids.slice(130,132);
        ops.push({op:'create_merge',id:'pan-test-merge',name:'Test merge',members});
        ops.push({op:'create_overlay',overlay:{id:'pan-test-overlay',sourceId:members[0],name:'Test overlay',mode:'shape',anchor:[-25,0],color:'#ff0000',opacity:0.5,texture:'none',scale:1}});
        if(c.mode==='flags')ops.push({op:'set_flags',patch:{enabled:true}});
        else if(c.mode==='compare')ops.push({op:'set_comparison',patch:{enabled:true}},{op:'add_to_comparison',index:0,countryIds:ids.slice(0,50)},{op:'add_to_comparison',index:1,countryIds:ids.slice(50,100)});
        else for(let i=0;i<80;i++)ops.push({op:'set_country_value',countryId:ids[i],value:i});
        const result=api.dispatch(ops); if(result && result.ok===false)throw Error(JSON.stringify(result));
        await sleep(3500);
      }
      const svg=document.querySelector('#map-canvas-svg'), b=svg.getBoundingClientRect();
      api.getState().setTransform({k:c.k,x:Math.round(-b.width*(c.k-1)/2),y:Math.round(-b.height*(c.k-1)/2)});
      svg.__zoom.k=c.k;svg.__zoom.x=Math.round(-b.width*(c.k-1)/2);svg.__zoom.y=Math.round(-b.height*(c.k-1)/2);
      await sleep(3000);
      return {paths:svg.querySelectorAll('[data-country-id]').length,selected:api.getState().selectedCountryIds.length,labels:svg.querySelectorAll('text').length,overlays:api.getState().doc.overlays.length,merges:api.getState().doc.merges.length,flags:api.getState().doc.flags.enabled,compare:api.getState().doc.comparison.enabled,water:!!api.getState().waters, fine:matchMedia('(any-pointer:fine)').matches};
    })()`)
    if(process.env.INJECT_JS)await evaluate(process.env.INJECT_JS)
    console.log(c.name, build, JSON.stringify(setup))
    shots[`${c.name}:${build}`] = await shot(`${c.name}-${build}-rest`)
    const centre = await evaluate(`(()=>{const b=document.querySelector('#map-canvas-svg').getBoundingClientRect();return [Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]})()`)
    const [x,y] = centre
    for (let cycle=0;cycle<Number(process.env.CYCLES??3);cycle++) {
      if(cycle){
        if(c.mobile){
          await touch('touchStart',[[x-30,y],[x+30,y]]);
          for(let j=1;j<=8;j++)await touch('touchMove',[[x-30-j*3,y],[x+30+j*3,y]]);
          await touch('touchEnd',[])
        } else {
          await S('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:cycle===1?-120:120})
        }
        await sleep(900)
      }
      await evaluate(`(()=>{
        window.__pan={frames:[],mutations:{},ctm:[],stores:0,commits:window.__reactCommits,active:true};const p=window.__pan;
        const svg=document.querySelector('#map-canvas-svg');
        p.mo=new MutationObserver(rs=>{for(const r of rs){const key=r.type==='attributes'?r.attributeName:r.type;p.mutations[key]=(p.mutations[key]||0)+1}});p.mo.observe(svg,{subtree:true,attributes:true,childList:true,characterData:true});
        p.getState=window.__mapEditor.getState; p.startTransform={...p.getState().transform};
        const loop=t=>{if(!p.active)return;p.frames.push(t);if(p.getState().transform!==p.previous && p.previous)p.stores++;p.previous=p.getState().transform;requestAnimationFrame(loop)};requestAnimationFrame(loop);
      })()`)
      const events=[];const onData=m=>{if(m.method==='Tracing.dataCollected')events.push(...m.params.value)};listeners.add(onData)
      await S('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,toplevel',transferMode:'ReportEvents'})
      const t0=performance.now()
      if(c.mobile)await touch('touchStart',[[x,y]]);else await mouse('mousePressed',x,y)
      const steps=60, pace=cycle===0?16:4, distance=cycle===0?30:150
      for(let i=1;i<=steps;i++){
        const d=Math.round(Math.sin(i/steps*Math.PI*2)*distance)
        if(c.mobile)await touch('touchMove',[[x+d,y+Math.round(d/2)]]);else await mouse('mouseMoved',x+d,y+Math.round(d/2))
        const wait=t0+i*pace-performance.now();if(wait>0)await sleep(wait)
      }
      await sleep(30)
      const metrics=await evaluate(`(()=>{const p=window.__pan;p.active=false;p.mo.disconnect();const frames=p.frames.slice(1).map((t,i)=>t-p.frames[i]).sort((a,b)=>a-b);return{reactCommits:window.__reactCommits-p.commits,mutations:p.mutations,storeChanges:p.stores,p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),camera:document.querySelector('#map-canvas-svg').__zoom,willChange:document.querySelector('#map-canvas-svg g[style*="--map-k"]').style.willChange}})()`)
      if(c.mobile)await touch('touchEnd',[]);else await mouse('mouseReleased',x,y)
      const wall=performance.now()-t0
      await sleep(500)
      const done=once('Tracing.tracingComplete');await S('Tracing.end');await done;listeners.delete(onData)
      const sums={};for(const e of events)if(e.ph==='X'&&['Paint','PrePaint','Commit','HitTest','Layout','UpdateLayoutTree','FunctionCall','EventDispatch'].includes(e.name))sums[e.name]=(sums[e.name]||0)+(e.dur||0)/1000
      const final=await evaluate(`(()=>{const s=window.__mapEditor.getState(),svg=document.querySelector('#map-canvas-svg'),g=svg.querySelector('g[style*="--map-k"]');return{camera:s.transform,d3:svg.__zoom,attr:g.getAttribute('transform'),pointerEvents:g.style.pointerEvents,willChange:g.style.willChange,selected:s.selectedCountryIds.length}})()`)
      if(metrics.storeChanges || metrics.mutations.d || metrics.reactCommits)throw Error('Pan rebuilt state/geometry: '+JSON.stringify(metrics))
      if(final.pointerEvents)throw Error('Hit testing not restored')
      if(JSON.stringify(final.camera)!==JSON.stringify(final.d3))throw Error('D3/store camera mismatch')
      const row={case:c.name,build,cycle,wall:Math.round(wall),ideal:steps*pace,...metrics,trace:sums,final};results.push(row)
      console.log(JSON.stringify(row))
      writeFileSync(process.env.OUT??'.cache/pan-results.json',JSON.stringify({results,errors},null,2))
    }
    // The same real pan at a known camera, for visual comparison during movement.
    await evaluate(`(()=>{const s=window.__mapEditor.getState(),svg=document.querySelector('#map-canvas-svg');const t={k:${c.k},x:-600,y:-350};s.setTransform(t);Object.assign(svg.__zoom,t)})()`)
    await sleep(1000)
    if(c.mobile){await touch('touchStart',[[x,y]]);for(let j=1;j<=5;j++){await sleep(20);await touch('touchMove',[[x+j*8,y+j*4]])}}
    else{await mouse('mousePressed',x,y);await mouse('mouseMoved',x+40,y+20)}
    await sleep(150)
    console.log('visual camera',c.name,build,await evaluate("document.querySelector('#map-canvas-svg').__zoom"))
    shots[`${c.name}-during:${build}`]=await shot(`${c.name}-${build}-during`)
    if(c.mobile)await touch('touchEnd',[]);else await mouse('mouseReleased',x+40,y+20)
    await sleep(500)
    // Verify real post-pan entity hit testing, including touch tap selection.
    await evaluate('window.__mapEditor.getState().clearSelection()')
    await sleep(300)
    const hit=await evaluate(`(()=>{for(let y=160;y<innerHeight-100;y+=25)for(let x=150;x<innerWidth-100;x+=25){const e=document.elementFromPoint(x,y)?.closest('[data-country-id]');if(e)return{x,y,id:e.getAttribute('data-country-id')}}return null})()`)
    if(!hit)throw Error('No visible entity available for hit-test regression')
    if(c.mobile){await touch('touchStart',[[hit.x,hit.y]]);await touch('touchEnd',[])}
    else{await mouse('mousePressed',hit.x,hit.y);await mouse('mouseReleased',hit.x,hit.y)}
    await sleep(300)
    const selected=await evaluate('window.__mapEditor.getState().selectedCountryIds')
    if(!selected.length)throw Error('Entity tap/click failed after navigation')
    assertions.push({case:c.name,build,hit,selected,touch:c.mobile??false})
  }
}
// Compare stationary pixels at identical cameras, including selected/label/overlay layers.
const pixels={}
for(const c of cases.flatMap(c=>[c,{...c,name:c.name+'-during'}])){
  const a=shots[`${c.name}:base`],b=shots[`${c.name}:candidate`];if(!a||!b)continue
  pixels[c.name]=await evaluate(`(async()=>{const load=s=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s});const [a,b]=await Promise.all([load(${JSON.stringify(a)}),load(${JSON.stringify(b)})]);const px=i=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data};const p=px(a),q=px(b);let changed=0,over16=0;for(let i=0;i<p.length;i+=4){const d=Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]));if(d)changed++;if(d>16)over16++}return{changed,over16,total:p.length/4}})()`)
}
writeFileSync(process.env.OUT??'.cache/pan-results.json',JSON.stringify({results,errors,pixels,assertions},null,2));console.log('pixels',pixels)
ws.close();edge.kill();await sleep(500)
// Only remove the isolated profile this process created inside the OS temporary directory.
if(!profileDir.startsWith(join(tmpdir(),'edge-perf-')))throw Error('Unexpected temporary profile path')
try { rmSync(profileDir,{recursive:true,force:true}) } catch {}
