import {build} from 'esbuild';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('.cache', {recursive:true});
await build({stdin:{contents:`export {ALL_DATASETS} from './src/maps/atlas';export {loadComposed} from './src/geo/composition';export {loadEntityMeta} from './src/geo/countryMeta';export {repairBirTawilBoundary} from './src/geo/boundaryRepair';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',define:{'import.meta.env.BASE_URL':'""'},outfile:'.cache/boundary-audit-module.mjs'});
global.fetch=async url=>({ok:true,json:async()=>JSON.parse(readFileSync('public/'+url,'utf8'))});
const {ALL_DATASETS,loadComposed,loadEntityMeta,repairBirTawilBoundary}=await import('../.cache/boundary-audit-module.mjs');
for(const ds of ALL_DATASETS){
 const {topology:t,metaIndex:m}=ds.compose?await loadComposed(ds):{topology:JSON.parse(readFileSync('public/'+ds.url,'utf8')),metaIndex:await loadEntityMeta(ds.metaUrl)};
 const country=g=>m.entities[String(g.id)]?.parent?.id??String(g.id);
 const before=t.objects[ds.objectName].geometries;const target=before.filter(g=>country(g)==='XBT');
 const original=JSON.stringify(before.filter(g=>['SDN','XBT'].includes(country(g))));
 const fixed=repairBirTawilBoundary(t,ds.objectName,m.entities);
 assert.equal(JSON.stringify(before.filter(g=>['SDN','XBT'].includes(country(g)))),original,'source mutated');
 assert.equal(repairBirTawilBoundary(fixed,ds.objectName,m.entities),fixed,'not idempotent');
 if(!target.length){assert.equal(t,fixed);console.log(ds.id,': no separate Bir Tawil; unchanged');continue}
 const owners=top=>{const out=new Map();for(const g of top.objects[ds.objectName].geometries)for(const i of (g.arcs??[]).flat(Infinity)){const n=i<0?~i:i;const ids=out.get(n)??new Set();ids.add(g.id);out.set(n,ids)}return out};
 const b=owners(t),a=owners(fixed);const arcs=target.flatMap(g=>g.arcs.flat(Infinity)).map(i=>i<0?~i:i);
 const missingBefore=arcs.filter(i=>b.get(i).size===1).length,missingAfter=arcs.filter(i=>a.get(i).size===1).length;
 assert.equal(missingAfter,0,'unshared Bir Tawil boundary '+ds.id);
 for(let i=0;i<before.length;i++)if(country(before[i])!=='SDN')assert.equal(fixed.objects[ds.objectName].geometries[i],before[i],'unrelated geometry changed');
 console.log(ds.id,': missing border arcs',missingBefore,'->',missingAfter);
}
