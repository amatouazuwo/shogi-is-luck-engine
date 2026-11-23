import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';

// The continuous WASM C API is synchronous and a regular 'stop' message
// cannot interrupt it. Test a HARD abort: terminate the entire Worker,
// ignore any stale reply, create a new one, and play a legal move afterwards.
// This is a laboratory safety check, not a production cancellation manager.
const sdk=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Usage: node abort-smoke.mjs CONTINUOUS_SDK');
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const source=pathToFileURL(resolve(sdk,'worker.js')).href;
const sfen='4k4/9/9/9/9/9/4R4/9/8K b - 1';
const holes=['5e'];
const bootstrap=`
const {parentPort,workerData}=require('node:worker_threads');
globalThis.self=globalThis;
globalThis.postMessage=x=>parentPort.postMessage(x);
const loaded=import(workerData);
parentPort.on('message',async data=>{
 await loaded;
 if(data.command==='go')parentPort.postMessage({entered:data.id});
 self.onmessage({data});
});`;
const create=()=>new Worker(bootstrap,{eval:true,workerData:source});
let nextId=0;
function once(worker,predicate,limit=15000){
 return new Promise((resolve,reject)=>{
  let done=false;
  const timer=setTimeout(()=>finish(Error('Worker wait timed out')),limit);
  function finish(err,value){
   if(done)return;
   done=true;clearTimeout(timer);
   worker.off('message',received);worker.off('error',failed);worker.off('exit',exited);
   if(err)reject(err);else resolve(value);
  }
  function received(value){if(predicate(value))finish(null,value);}
  function failed(error){finish(error);}
  function exited(code){finish(Error('Worker exited before reply '+code));}
  worker.on('message',received);worker.on('error',failed);worker.on('exit',exited);
 });
}
async function request(worker,command,fields={}){
 const id=++nextId,reply=once(worker,x=>x.id===id&&x.event!=='info');
 worker.postMessage({id,command,...fields});
 const v=await reply;
 assert.equal(v.ok,true,JSON.stringify(v));
 return v.result;
}
async function initialize(worker){
 await request(worker,'init',{wasm,hash_mb:16});
 await request(worker,'position',{sfen,holes});
 const legal=await request(worker,'legalMoves');
 assert.ok(legal.length>0,'No legal obstacle moves');
 return legal;
}
const first=create();
let stale=0,terminationMs=null,exitCode=null;
try{
 await initialize(first);
 const id=++nextId;
 first.on('message',x=>{if(x.id===id&&x.event==='bestmove')stale++;});
 const ready=once(first,x=>x.entered===id);
 first.postMessage({id,command:'go',depth:64,movetime_ms:1500});
 await ready;
 await new Promise(resolve=>setTimeout(resolve,45));
 const before=performance.now();
 exitCode=await first.terminate();
 terminationMs=performance.now()-before;
 assert.equal(stale,0,'An aborted obsolete search produced a move');
}finally{if(terminationMs===null)await first.terminate();}
const second=create(),restartStarted=performance.now();
let newMove;
try{
 const legal=await initialize(second);
 newMove=await request(second,'go',{depth:64,movetime_ms:100});
 assert.ok(legal.includes(newMove.bestmove),'Restarted native engine played an illegal move: '+newMove.bestmove);
 assert.ok(Number.isFinite(newMove.nodes)&&newMove.nodes>=0);
}finally{await second.terminate();}
const metrics={exitCode,terminationMs,restartAndMoveMs:performance.now()-restartStarted,
 staleBestMoves:stale,recoveredMove:newMove.bestmove,recoveredDepth:newMove.depth,
 warning:'Hard Worker termination safely drops the cancelled result, but full WASM/model reinitialization adds latency. It does not preserve a best move for the aborted turn.'};
assert.ok(terminationMs<2000,'Worker hard abortion took too long');
console.log(JSON.stringify(metrics));
