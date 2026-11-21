import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { seedRng } from './rules.mjs';
const sdk=resolve(process.env.OBSTACLE_SDK||strengthJoin(strengthGame, 'ai/obstacle-sdk'));
const corpusPath=process.env.TACTICS_CORPUS||new URL('corpus.jsonl',import.meta.url);
const raw=readFileSync(corpusPath,'utf8');
const corpus=raw.trim().split('\n').map(JSON.parse);
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const protocol=pathToFileURL(resolve(sdk,'worker.js')).href;
const stat=()=>Number(readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/nr_throttled (\d+)/)[1]);
const print=record=>console.log(JSON.stringify(record));
const budgets=(process.argv[2]||'100,500,1500').split(',').map(Number);
assert.ok(budgets.every(n=>[100,500,1500].includes(n)));
const seed=286325;
const random=seedRng(seed);
function shuffle(items){
  const order=items.slice();
  for(let i=order.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [order[i],order[j]]=[order[j],order[i]];
  }
  return order;
}
print({event:'config',wasmSha256:digest(wasm),workerSha256:digest(readFileSync(resolve(sdk,'worker.js'))),
  corpusSha256:digest(raw),positions:corpus.length,budgets,seed,hash_mb:16,threads:1,deadlineExtraMs:1750,
  note:'Actual archived browser worker under Node worker_threads; prepared warm. No test publishes requests or runs a Render service.'});

class Harness {
  constructor() {
    this.id=0;
    this.worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      globalThis.self=globalThis;
      globalThis.postMessage=data=>parentPort.postMessage(data);
      const loaded=import(workerData);
      parentPort.on('message',async data=>{await loaded; self.onmessage({data});});
    `,{eval:true,workerData:protocol});
    this.worker.on('error',error=>{this.error=error;});
  }
  command(command,args={},timeout=10000){
    if(this.error)return Promise.reject(this.error);
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const finish=(error,value)=>{
        clearTimeout(timer);
        this.worker.off('message',receive);
        this.worker.off('error',onError);
        if(error)reject(error);
        else resolve(value);
      };
      const onError=error=>finish(error);
      const receive=message=>{
        if(message.id!==id||message.event==='info')return;
        finish(message.ok?null:Error(command+': '+message.error),message.result);
      };
      const timer=setTimeout(()=>finish(Object.assign(Error(command+' timeout'),{timedOut:true})),timeout);
      this.worker.on('message',receive);
      this.worker.on('error',onError);
      this.worker.postMessage({id,command,...args});
    });
  }
  close(){return this.worker.terminate();}
}
async function prepare(){
  const run=new Harness();
  await run.command('init',{wasm,hash_mb:16});
  await run.command('position',{sfen:corpus[0].sfen,holes:corpus[0].holes,moves:[]});
  await run.command('go',{depth:64,movetime_ms:100});
  return run;
}
let engine=await prepare();
try {
  for(const budget of budgets){
    const outcomes=[];
    for(const item of shuffle(corpus)){
      const {id,kind,category,sfen,holes,available,goodMoves}=item;
      const trial={event:'trial',id,kind,category,budget};
      try {
        await engine.command('new_game');
        const start=performance.now();
        const cpuBefore=stat();
        await engine.command('position',{sfen,holes,moves:[]});
        const result=await engine.command('go',{depth:64,movetime_ms:budget},Math.max(1,budget+1750-(performance.now()-start)));
        const wallMs=performance.now()-start;
        const move=result?.bestmove;
        const legal=available.length?available.includes(move):move==='resign';
        Object.assign(trial,{success:goodMoves.includes(move),legal,move,wallMs,elapsedMs:result?.elapsed_ms,
          depth:result?.depth,nodes:result?.nodes,resign:move==='resign',terminal:available.length===0,
          timeout:false,overBudgetBy50:wallMs>budget+50,throttlingIntervals:stat()-cpuBefore});
      } catch(error) {
        Object.assign(trial,{success:false,legal:null,timeout:error.timedOut===true,error:error.message});
        await engine.close();
        engine=await prepare();
      }
      outcomes.push(trial);
      print(trial);
    }
    const summarize=(rows)=>({
      count:rows.length,accurate:rows.filter(r=>r.success).length,
      illegal:rows.filter(r=>r.legal===false).length,hardTimeouts:rows.filter(r=>r.timeout).length,
      errors:rows.filter(r=>r.error&&!r.timeout).length,
      overshoot50:rows.filter(r=>r.overBudgetBy50).length,throttled:rows.filter(r=>r.throttlingIntervals).length,
      totalNodes:rows.reduce((sum,r)=>sum+(r.nodes||0),0),totalDepth:rows.reduce((sum,r)=>sum+(r.depth||0),0),
      meanWallMs:rows.reduce((sum,r)=>sum+(r.wallMs||0),0)/rows.length,maxWallMs:Math.max(...rows.map(r=>r.wallMs||0)),
    });
    for(const [group,rows] of Map.groupBy(outcomes,x=>x.kind+'/'+x.category))print({event:'summary',budget,group,...summarize(rows)});
    print({event:'summary',budget,group:'all',...summarize(outcomes)});
  }
}finally{await engine.close();}
