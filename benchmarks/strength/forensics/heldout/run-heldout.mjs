import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const options = parseArgs({options:{
  corpus:{type:'string'},
  sdk:{type:'string',multiple:true},
  budget:{type:'string',default:'100,500,1500'},
  seed:{type:'string',default:'822433'},
  rounds:{type:'string',default:'1'},
}});
const args=options.values;
assert.ok(args.corpus&&args.sdk?.length,'--corpus PATH --sdk NAME=PATH [--sdk NAME=PATH]');
const budgets=args.budget.split(',').map(Number);
assert.ok(budgets.length>0&&budgets.every(n=>Number.isInteger(n)&&n>0&&n<=10000));
const rounds=Number(args.rounds);
assert.ok(Number.isSafeInteger(rounds)&&rounds>0);
const bytes=readFileSync(args.corpus);
const corpus=bytes.toString('utf8').trim().split('\n').map(JSON.parse).filter(x=>x.id);
assert.ok(corpus.length);
assert.equal(new Set(corpus.map(x=>x.id)).size,corpus.length);
for(const puzzle of corpus){
  assert.ok(Array.isArray(puzzle.goodMoves)&&puzzle.goodMoves.length>0,puzzle.id);
  assert.ok(Array.isArray(puzzle.available)&&Array.isArray(puzzle.holes),puzzle.id);
  assert.ok(puzzle.goodMoves.every(m=>puzzle.available.includes(m)||m==='resign'&&puzzle.available.length===0),puzzle.id);
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const print=data=>console.log(JSON.stringify(data));
const throttled=()=>{
  try{return Number(readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/nr_throttled (\d+)/)[1]);}
  catch{return null;}
};
const engines=[];
for(const option of args.sdk){
  const i=option.indexOf('=');
  assert.ok(i>0&&i<option.length-1,'--sdk must be NAME=PATH');
  const name=option.slice(0,i);
  assert.ok(!engines.some(x=>x.name===name),'Duplicate SDK name '+name);
  const directory=resolve(option.slice(i+1));
  const workerJs=resolve(directory,'worker.js');
  const wasm=readFileSync(resolve(directory,'rsshogi_nnue_mini.wasm'));
  engines.push({name,workerJs,workerSha256:digest(readFileSync(workerJs)),wasmSha256:digest(wasm),wasm});
}
let rng=Number(args.seed)>>>0;
function shuffle(items){
  const out=items.slice();
  for(let i=out.length-1;i>0;i--){
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    const j=Math.floor((rng/4294967296)*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
class SDK {
  constructor(engine) {
    this.variant=engine;
    this.seq=0;
    this.thread=new Worker(`
      const {workerData,parentPort}=require('node:worker_threads');
      globalThis.self=globalThis;
      globalThis.postMessage=message=>parentPort.postMessage(message);
      const loaded=import(workerData);
      parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
    `,{eval:true,workerData:pathToFileURL(engine.workerJs).href});
    this.thread.on('error',error=>{this.error=error;});
  }
  request(command,fields={},ms=10000) {
    if(this.error)return Promise.reject(this.error);
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const finish=(error,data)=>{
        clearTimeout(timer);
        this.thread.off('message',receive);
        this.thread.off('error',onError);
        if(error)reject(error);
        else resolve(data);
      };
      const onError=error=>finish(error);
      const receive=message=>{
        if(message.id!==id||message.event==='info')return;
        finish(message.ok===false?Error(command+': '+message.error):null,message.result);
      };
      const timer=setTimeout(()=>finish(Object.assign(Error(command+' timed out'),{timeout:true})),ms);
      this.thread.on('message',receive);
      this.thread.on('error',onError);
      this.thread.postMessage({id,command,...fields});
    });
  }
  async warm() {
    await this.request('init',{wasm:this.variant.wasm,hash_mb:16});
    const {sfen,holes}=corpus[0];
    await this.request('position',{sfen,holes,moves:[]});
    await this.request('go',{depth:64,movetime_ms:100});
  }
  close(){return this.thread.terminate();}
}
async function prepare(engine) {
  const sdk=new SDK(engine);
  try{await sdk.warm();return sdk;}
  catch(error){await sdk.close();throw error;}
}

const active=new Map();
const all=[];
const paired=[];
try{
  print({event:'config',corpusSha256:digest(bytes),positions:corpus.length,budgets,rounds,seed:rng,hash_mb:16,
    timeoutExtraMs:1750,sdk:engines.map(({wasm,...entry})=>entry)});
  for(const engine of engines)active.set(engine.name,await prepare(engine));
  for(const budget of budgets){
    for(let round=0;round<rounds;round++){
      for(const [index,puzzle] of shuffle(corpus).entries()){
        const results=[];
        for(let inner=0;inner<engines.length;inner++){
          const engine=engines[(inner+index+round)%engines.length];
          const name=engine.name;
          const entry=active.get(name);
          const data={event:'trial',name,id:puzzle.id,kind:puzzle.kind,category:puzzle.category,budget,round};
          try{
            await entry.request('new_game');
            const cpuStart=throttled();
            const start=performance.now();
            await entry.request('position',{sfen:puzzle.sfen,holes:puzzle.holes,moves:[]},budget+1750);
            const result=await entry.request('go',{depth:64,movetime_ms:budget},Math.max(1,budget+1750-(performance.now()-start)));
            const wallMs=performance.now()-start;
            const {bestmove,depth,nodes,score,pv,elapsed_ms}=result;
            const legal=puzzle.available.length?puzzle.available.includes(bestmove):bestmove==='resign';
            const cpuEnd=throttled();
            Object.assign(data,{move:bestmove,legal,correct:legal&&puzzle.goodMoves.includes(bestmove),depth,nodes,score,pv,
              wallMs,workerMs:elapsed_ms,overBudget50:wallMs>budget+50,timeout:false,
              throttlingIntervals:cpuStart!==null&&cpuEnd!==null?cpuEnd-cpuStart:null});
          }catch(error){
            Object.assign(data,{error:error.message,timeout:error.timeout===true,correct:false,legal:null});
            await entry.close();
            active.set(name,await prepare(engine));
          }
          print(data);all.push(data);results.push(data);
        }
        paired.push({budget,results});
      }
    }
  }
}finally{
  await Promise.all([...active.values()].map(sdk=>sdk.close()));
}
const count=(list,condition)=>list.filter(condition).length;
const average=(list,get)=>list.length?list.reduce((sum,x)=>sum+get(x),0)/list.length:null;
const summarize=trials=>{
  const responses=trials.filter(t=>!t.error);
  return {
    trials:trials.length,correct:count(trials,x=>x.correct),illegal:count(trials,x=>x.legal===false),
    timeout:count(trials,x=>x.timeout),errors:count(trials,x=>x.error&&!x.timeout),
    overBudget50:count(trials,x=>x.overBudget50),
    meanDepth:average(responses,x=>x.depth),meanNodes:average(responses,x=>x.nodes),meanWallMs:average(responses,x=>x.wallMs),
  };
};
for(const budget of budgets){
  for(const {name} of engines){
    const trials=all.filter(t=>t.budget===budget&&t.name===name);
    print({event:'summary',name,budget,group:'all',...summarize(trials)});
    for(const [group,rows] of Map.groupBy(trials,t=>t.kind+'/'+t.category)){
      print({event:'summary',name,budget,group,...summarize(rows)});
    }
  }
  if(engines.length===2){
    const [baseline,candidate]=engines.map(x=>x.name);
    const comparisons=paired.filter(x=>x.budget===budget).map(({results})=>Object.fromEntries(results.map(t=>[t.name,t])));
    print({event:'pairs',budget,baseline,candidate,rounds,pairs:comparisons.length,
      improved:count(comparisons,x=>!x[baseline].correct&&x[candidate].correct),
      regressed:count(comparisons,x=>x[baseline].correct&&!x[candidate].correct),
      bothCorrect:count(comparisons,x=>x[baseline].correct&&x[candidate].correct),
      bothMissed:count(comparisons,x=>!x[baseline].correct&&!x[candidate].correct),
    });
  }
}
