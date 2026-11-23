import {Worker} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const sdk=resolve(process.argv[2] || 'sdk');
const url=pathToFileURL(resolve(sdk,'worker.js')).href;
const source='const {parentPort,workerData}=require("node:worker_threads"); global.self=global; global.postMessage=x=>parentPort.postMessage(x); import(workerData).then(()=>{parentPort.on("message",data=>self.onmessage({data}));parentPort.postMessage({ready:true});});';
const worker=new Worker(source,{eval:true,workerData:url});
try {
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  let id=0;
  function send(command,fields={}){
    return new Promise((resolve,reject)=>{
      const current=++id;
      const timer=setTimeout(()=>{worker.off('message',listen);reject(Error('worker timeout '+command));},15000);
      function listen(r){if(r.id!==current||r.event==='info')return;clearTimeout(timer);worker.off('message',listen);resolve(r);}
      worker.on('message',listen);worker.postMessage({command,id:current,...fields});
    });
  }
  const wasm=await readFile(resolve(sdk,'rsshogi_nnue_mini.wasm'));
  assert.equal((await send('init',{wasm,hash_mb:4})).ok,true);
  const sfen='4k4/9/9/9/9/9/4R4/9/8K b - 1';
  for(const holes of [['5e'],['4d','5d','6d','4e','5e','6e','4f','5f','6f']]){
    assert.equal((await send('position',{sfen,holes})).ok,true);
    const r=await send('go',{depth:64,movetime_ms:100});
    const {result:legal}=await send('legalMoves');
    assert.ok(legal.includes(r.result.bestmove));
    assert.equal(r.ok,true);assert.ok(r.result.nodes>0);assert.ok(!holes.includes(r.result.bestmove.slice(2,4)));
    console.log('OBSTACLE_WORKER_PASS',r.result.bestmove);
  }
  assert.equal((await send('position',{sfen:'startpos'})).ok,true);
  assert.equal((await send('go',{depth:2,movetime_ms:100})).ok,true);
} finally {await worker.terminate();}
