import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import test from 'node:test';

const workerSource=resolve('benchmarks/strength/experiments/continuous-obstacle/worker.js');
const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'rsshogi-continuous-worker-'));
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 copyFileSync(workerSource,join(root,'worker.js'));
 writeFileSync(join(root,'mini.js'),`
 export class MiniEngine {
  static async create(){return new MiniEngine();}
  calls=0;
  request({command,...options}){
   if(command==='search'){
    this.calls++;
    return {ok:true,result:{bestmove:'7g7f',depth:6,nodes:123,searchNumber:this.calls,
     allottedTime:options.movetime_ms,allottedDepth:options.depth}};
   }
   if(command==='legal_moves')return {ok:true,result:['7g7f']};
   if(command==='set_obstacle_position')return {ok:true,result:{position:'obstacle',holes:options.holes}};
   if(command==='set_position')return {ok:true,result:{position:'normal'}};
   return {ok:true,result:{}};
  }
  dispose(){}
 }`);
 const src=`
 const {parentPort,workerData}=require('node:worker_threads');
 globalThis.self=globalThis;
 globalThis.postMessage=x=>parentPort.postMessage(x);
 const loaded=import(workerData);
 parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
 `;
 const w=new Worker(src,{eval:true,workerData:pathToFileURL(join(root,'worker.js')).href});
 let seq=0;
 const send=(command,fields={})=>new Promise((resolve,reject)=>{
  const id=++seq;const timer=setTimeout(()=>{w.off('message',receive);reject(Error('Timed out: '+command));},3000);
  function receive(value){
   if(value.id!==id||value.event==='info')return;
   clearTimeout(timer);w.off('message',receive);resolve(value);
  }
  w.on('message',receive);
  w.postMessage({id,command,...fields});
 });
 const close=async()=>{await w.terminate();rmSync(root,{recursive:true,force:true});};
 return {send,close};
};
test('single continuous request uses exact budget and maintains the obstacle route',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.send('init',{wasm:new Uint8Array(8),hash_mb:16})).ok,true);
  const p=await f.send('position',{sfen:'valid-sfen',holes:['5e'],moves:[]});
  assert.deepEqual(p.result,{position:'obstacle',holes:['5e']});
  const legal=await f.send('legalMoves');
  assert.deepEqual(legal.result,['7g7f']);
  const go=await f.send('go',{depth:64,movetime_ms:100});
  assert.equal(go.ok,true);
  assert.equal(go.event,'bestmove');
  assert.equal(go.result.bestmove,'7g7f');
  assert.equal(go.result.searchNumber,1);
  assert.equal(go.result.allottedDepth,64);
  assert.equal(go.result.allottedTime,100);
  const again=await f.send('go',{depth:32,movetime_ms:500});
  assert.equal(again.result.searchNumber,2);
  assert.equal(again.result.allottedTime,500);
 }finally{await f.close();}
});
test('rejects malformed obstacle fields and replay while keeping normal positions',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.send('init',{wasm:new Uint8Array(8)})).ok,true);
  assert.equal((await f.send('position',{sfen:'x',holes:'5e'})).ok,false);
  assert.match((await f.send('position',{sfen:'x',holes:['5e'],moves:['7g7f']})).error,/without replay/);
  const normal=await f.send('position',{sfen:'startpos',holes:[]});
  assert.equal(normal.ok,true);
  assert.equal(normal.result.position,'normal');
  assert.equal((await f.send('go',{depth:0,movetime_ms:100})).ok,false);
  assert.equal((await f.send('go',{depth:64})).ok,false);
 }finally{await f.close();}
});
