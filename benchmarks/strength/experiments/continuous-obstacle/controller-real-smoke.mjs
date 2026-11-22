import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker as NativeWorker} from 'node:worker_threads';
import {ContinuousSearchController} from './continuous-controller.mjs';

const sdk=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Usage: node controller-real-smoke.mjs CONTINUOUS_SDK');
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const source=pathToFileURL(resolve(sdk,'worker.js')).href;
const bootstrap=`
const {parentPort,workerData}=require('node:worker_threads');
globalThis.self=globalThis;
globalThis.postMessage=data=>parentPort.postMessage(data);
const loaded=import(workerData);
parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
`;
const shims=[];
class BrowserStyleNodeWorker{
 constructor(){
  this.onmessage=null;this.onerror=null;this.commands=[];this.terminated=false;
  this.native=new NativeWorker(bootstrap,{eval:true,workerData:source});
  this.native.on('message',data=>this.onmessage?.({data}));
  this.native.on('error',error=>this.onerror?.({message:error.message}));
  shims.push(this);
 }
 postMessage(data){this.commands.push(data.command);this.native.postMessage(data);}
 terminate(){this.terminated=true;return this.native.terminate();}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,limit=12000){
 const started=performance.now();
 while(!predicate()){
  if(performance.now()-started>limit)throw Error('Search never entered go');
  await sleep(10);
 }
}
const ctrl=new ContinuousSearchController({
 createWorker:()=>new BrowserStyleNodeWorker(),
 wasm,commandTimeoutMs:15000,searchGraceMs:2000
});
const sfen='4k4/9/9/9/9/9/4R4/9/8K b - 1';
const start=performance.now();
try{
 const pending=ctrl.think({sfen,holes:['5e'],movetimeMs:1500});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await until(()=>shims[0]?.commands.includes('go'));
 await sleep(45);
 const at=performance.now();
 await ctrl.cancel();
 const cancelMs=performance.now()-at;
 await rejected;
 assert.equal(shims[0].terminated,true);
 const afterCancel=performance.now();
 const recovered=await ctrl.think({sfen,holes:['5e'],movetimeMs:100});
 const restartAndMoveMs=performance.now()-afterCancel;
 assert.match(recovered.bestmove,/^[1-9][a-i][1-9][a-i]\\+?$/);
 assert.ok(recovered.elapsedWallMs>0);
 assert.equal(shims.length,2,'Expected exactly one restart');
 const beforeNext=shims.length;
 const normal=await ctrl.think({sfen,holes:[],movetimeMs:100});
 assert.match(normal.bestmove,/^[1-9][a-i][1-9][a-i]\\+?$/);
 assert.equal(shims.length,beforeNext,'Healthy Worker should be reused');
 console.log(JSON.stringify({status:'PASS',workersCreated:shims.length,
  cancelledBestmoveReturned:false,cancelMs,restartAndMoveMs,
  recoveredObstacleMove:recovered.bestmove,recoveredNormalMove:normal.bestmove,
  normalWorkerReused:true,wholeTestWallMs:performance.now()-start,
  note:'Node native Worker is a browser-Worker protocol adapter; actual browser UI integrations require their own tests.'}));
}finally{await ctrl.close();}
