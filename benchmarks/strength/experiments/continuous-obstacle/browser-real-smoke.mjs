import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// REAL Chromium + actual rsshogi WASM. This exercises the browser's module
// Worker, including its terminate() behavior (not Node's Worker adapter).
// This is a test harness, NOT the production game's UI or clock integration.
const sdk=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Usage: node browser-real-smoke.mjs CONTINUOUS_SDK');
const deps=process.env.PLAYWRIGHT_NODE_MODULES;
assert.ok(deps,'PLAYWRIGHT_NODE_MODULES must point to npm installation');
const require=createRequire(join(resolve(deps),'package.json'));
const {chromium,devices}=require('playwright');
const controllerPath=fileURLToPath(new URL('./continuous-controller.mjs',import.meta.url));
const served={
 '/':{data:'<!doctype html><title>rsshogi Worker browser check</title><meta charset="utf-8">',mime:'text/html'},
 '/controller.mjs':{data:readFileSync(controllerPath),mime:'text/javascript'},
};
for(const name of ['worker.js','mini.js','rsshogi_nnue_mini.wasm','package.json']){
 const type=name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'text/javascript';
 served['/sdk/'+name]={data:readFileSync(join(sdk,name)),mime:type};
}
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 const asset=served[path];
 if(!asset){res.writeHead(404);res.end('Not Found');return;}
 res.writeHead(200,{'Content-Type':asset.mime,'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'});
 res.end(asset.data);
});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try{
 for(const [profile,device] of [['desktop',{}],['Pixel 7',devices['Pixel 7']]]){
  const page=await browser.newPage(device);
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  try{
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.evaluate(async()=>{
    const {ContinuousSearchController}=await import('/controller.mjs');
    const bytes=new Uint8Array(await (await fetch('/sdk/rsshogi_nnue_mini.wasm')).arrayBuffer());
    window.trace=[];window.testWorkers=[];
    const OriginalWorker=window.Worker;
    class TracedWorker extends OriginalWorker{
     constructor(...args){
      super(...args);
      this.testId=window.testWorkers.push(this);
      window.trace.push({kind:'created',worker:this.testId});
     }
     postMessage(data,...other){
      window.trace.push({kind:'sent',worker:this.testId,id:data.id,command:data.command});
      return super.postMessage(data,...other);
     }
     terminate(){
      window.trace.push({kind:'terminated',worker:this.testId});
      return super.terminate();
     }
    }
    window.Worker=TracedWorker;
    window.subject=new ContinuousSearchController({
     createWorker:()=>new Worker('/sdk/worker.js',{type:'module'}),
     wasm:bytes,commandTimeoutMs:20000,searchGraceMs:3000
    });
    window.startSfen='lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
    window.fullBlackhole=['6d','5d','4d','6e','5e','4e','6f','5f','4f'];
    window.movesAccepted=[];
   });
   const old=await page.evaluate(async()=>{
    const base={sfen:window.startSfen,movetimeMs:100,clockRemainingMs:180000};
    const normal=await window.subject.think({...base,holes:[]});
    const pit=await window.subject.think({...base,holes:['5e']});
    const blackhole=await window.subject.think({...base,holes:window.fullBlackhole});
    window.movesAccepted.push(normal.bestmove,pit.bestmove,blackhole.bestmove);
    return {normalMove:normal.bestmove,pitMove:pit.bestmove,blackholeMove:blackhole.bestmove,
     workers:window.testWorkers.length,initialCommands:window.trace.map(x=>x.command).filter(Boolean),
     remainingClockMs:normal.remainingClockMs};
   });
   assert.equal(old.workers,1,'Healthy browser Worker must be reused between three searches');
   assert.equal(old.initialCommands.filter(x=>x==='go').length,3);
   for(const move of [old.normalMove,old.pitMove,old.blackholeMove])assert.match(move,/^([1-9][a-i][1-9][a-i]\+?|[RBGSNLP]\*[1-9][a-i])$/);
   assert.ok(old.remainingClockMs>0);

   await page.evaluate(()=>{
    window.abortOffset=window.trace.length;
    window.aborted=window.subject.think({
     sfen:window.startSfen,holes:['5e'],movetimeMs:1500
    }).then(value=>({status:'UNEXPECTED_MOVE',bestmove:value.bestmove}),
             error=>({status:error.name,message:error.message}));
   });
   await page.waitForFunction(()=>
    window.trace.slice(window.abortOffset).some(x=>x.command==='go'),null,{timeout:15000});
   const result=await page.evaluate(async()=>{
    const sent=window.trace.slice(window.abortOffset).find(x=>x.command==='go');
    const priorWorker=window.testWorkers[sent.worker-1];
    const priorHandler=priorWorker.onmessage;
    await new Promise(r=>setTimeout(r,40));
    await window.subject.cancel();
    const abandoned=await window.aborted;
    // A late callback from the old worker is injected after a new scene
    // has begun. It must not mutate the next session or produce a move.
    const before=window.movesAccepted.length;
    window.injectStale=()=>priorHandler?.({data:{
     id:sent.id,ok:true,event:'bestmove',result:{bestmove:'7g7f'}
    }});
    const recovered=await window.subject.think({
     sfen:window.startSfen,holes:['4e'],movetimeMs:100,
     clockRemainingMs:180000
    });
    window.injectStale();
    window.movesAccepted.push(recovered.bestmove);
    return {abandoned,workerTerminated:window.trace.some(x=>x.kind==='terminated'&&x.worker===sent.worker),
     newWorkers:window.testWorkers.length,oldResponseApplied:window.movesAccepted.length!==before+1,
     recoveredMove:recovered.bestmove,
     finalPositionHoles:window.trace.filter(x=>x.command==='position').length};
   });
   assert.deepEqual(result.abandoned.status,'AbortError');
   assert.equal(result.workerTerminated,true);
   assert.equal(result.oldResponseApplied,false);
   assert.equal(result.newWorkers,2);
   assert.match(result.recoveredMove,/^([1-9][a-i][1-9][a-i]\+?|[RBGSNLP]\*[1-9][a-i])$/);
   const clock=await page.evaluate(async()=>{
    try{
     await window.subject.think({
      sfen:window.startSfen,holes:[],movetimeMs:100,clockRemainingMs:1
     });
     return 'UNEXPECTED_MOVE';
    }catch(error){return error.message;}
   });
   assert.match(clock,/Clock exhausted during search/);
   const afterClock=await page.evaluate(async()=>{
    const recovered=await window.subject.think({
     sfen:window.startSfen,holes:['5e'],movetimeMs:100,clockRemainingMs:180000
    });
    const count=window.testWorkers.length;
    await window.subject.close();
    return {bestmove:recovered.bestmove,workers:count,
     terminated:window.trace.filter(x=>x.kind==='terminated').length};
   });
   assert.ok(afterClock.workers>=3,'Clock expiry should retire the Worker');
   assert.ok(afterClock.terminated>=2);
   assert.deepEqual(errors,[],'Unexpected page errors: '+errors.join('; '));
   const info={event:'browser-continuous-check',profile,...old,...result,clock,
    afterClock,scriptErrors:errors};
   console.log(JSON.stringify(info));results.push(info);
  }catch(e){
   console.log(JSON.stringify({event:'browser-failure',profile,error:String(e),scriptErrors:errors}));
   throw e;
  }finally{await page.close();}
 }
}finally{await browser.close();await new Promise(done=>server.close(done));}
assert.equal(results.length,2,'Desktop and emulated Pixel7 must both pass');
console.log(JSON.stringify({event:'summary',status:'PASS',profiles:results.map(x=>x.profile),
 checks:['same WASM in Chromium module Worker','normal/pit/blackhole legal play',
  'Worker reuse','real terminate','stale callback discarded','new obstacle scene',
  'late result prohibited by 3-minute wall clock','post-timeout recovery']}));
