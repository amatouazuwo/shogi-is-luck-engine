import assert from 'node:assert/strict';
import test from 'node:test';
import {ContinuousSearchController} from './continuous-controller.mjs';
const nap=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class MockWorker{
 constructor({goDelay=8,initDelay=1,deliverLate=false}={}){
  this.goDelay=goDelay;this.initDelay=initDelay;this.deliverLate=deliverLate;
  this.onmessage=null;this.onerror=null;this.terminated=false;this.sent=[];this.replays=[];
 }
 postMessage(msg){
  this.sent.push(msg);
  const response={id:msg.id,command:msg.command,ok:true,result:msg.command==='legalMoves'?
   ['7g7f','2g2f']:msg.command==='go'?{bestmove:'7g7f',depth:7,nodes:999}:{ok:true}};
  const handler=this.onmessage;
  this.replays.push(()=>handler?.({data:response}));
  const delay=msg.command==='go'?this.goDelay:msg.command==='init'?this.initDelay:1;
  setTimeout(()=>{if(!this.terminated||this.deliverLate)handler?.({data:response});},delay);
 }
 terminate(){this.terminated=true;}
}
const position={sfen:'4k4/9/9/9/9/9/2P6/9/4K4 b - 1',holes:['5e'],movetimeMs:100};
test('two consecutive moves reuse one worker and invoke one continuous go each',async()=>{
 const workers=[];
 const c=new ContinuousSearchController({createWorker:()=>{const x=new MockWorker();workers.push(x);return x;},wasm:new Uint8Array(8)});
 try{
  const a=await c.think(position);assert.equal(a.bestmove,'7g7f');
  assert.equal(a.requestedSearchMs,100);
  const b=await c.think({...position,clockRemainingMs:1000});
  assert.equal(b.requestedSearchMs,50);
  assert.equal(workers.length,1);
  assert.deepEqual(workers[0].sent.map(x=>x.command),
   ['init','position','legalMoves','go','position','legalMoves','go']);
 }finally{await c.close();}
});
test('hard cancel discards old bestmove; a fresh worker can continue on the new board',async()=>{
 const workers=[];
 const c=new ContinuousSearchController({createWorker:()=>{const x=new MockWorker({goDelay:70,deliverLate:true});workers.push(x);return x;},wasm:new Uint8Array(8)});
 try{
  const stale=c.think(position);await nap(18);await c.cancel();
  await assert.rejects(stale,{name:'AbortError'});
  assert.ok(workers[0].terminated);
  const fresh=c.think({...position,holes:['4e']});
  await nap(5);
  workers[0].replays.at(-1)();
  const result=await fresh;
  assert.equal(result.bestmove,'7g7f');
  assert.equal(workers.length,2);
  assert.equal(workers[1].sent.find(x=>x.command==='position').holes[0],'4e');
 }finally{await c.close();}
});
test('AbortSignal yields no move for the abandoned turn',async()=>{
 const c=new ContinuousSearchController({createWorker:()=>new MockWorker({goDelay:80}),wasm:new Uint8Array(8)});
 try{
  const abort=new AbortController();
  const pending=c.think({...position,signal:abort.signal});
  await nap(12);abort.abort();
  await assert.rejects(pending,{name:'AbortError'});
 }finally{await c.close();}
});
test('search timeout retires Worker and next search can restart',async()=>{
 let n=0;
 const c=new ContinuousSearchController({createWorker:()=>new MockWorker({goDelay:++n===1?180:1}),wasm:new Uint8Array(8),searchGraceMs:4});
 try{
  await assert.rejects(c.think({...position,movetimeMs:10}),/timed out/);
  const fresh=await c.think({...position,movetimeMs:10});
  assert.equal(fresh.bestmove,'7g7f');assert.equal(n,2);
 }finally{await c.close();}
});
test('closed and expired clocks cannot dispatch a move',async()=>{
 const c=new ContinuousSearchController({createWorker:()=>new MockWorker(),wasm:new Uint8Array(8)});
 await assert.rejects(c.think({...position,clockRemainingMs:0}),/Clock exhausted/);
 await c.close();
 await assert.rejects(c.think(position),{name:'AbortError'});
});

test('three-minute clock includes worker initialization; never apply a late move',async()=>{
 const workers=[];
 const c=new ContinuousSearchController({
  createWorker:()=>{const w=new MockWorker({initDelay:35,goDelay:10});workers.push(w);return w;},
  wasm:new Uint8Array(8)
 });
 try{
  // A native go can fit its allocated budget even when startup time exceeds
  // the actual remaining turn clock. That still must not produce a move.
  await assert.rejects(c.think({...position,clockRemainingMs:20}),/Clock exhausted during search/);
  assert.equal(workers.length,1);
  assert.equal(workers[0].terminated,true,'Expired search must retire the worker');
  const recovered=await c.think({...position,clockRemainingMs:3000});
  assert.equal(recovered.bestmove,'7g7f');
  assert.ok(recovered.remainingClockMs>0);
  assert.equal(workers.length,2);
 }finally{await c.close();}
});
