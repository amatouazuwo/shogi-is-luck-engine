import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';

const {values:args}=parseArgs({options:{
  baseline:{type:'string'},candidate:{type:'string'},fixtures:{type:'string'},heldout:{type:'string'},
  mode:{type:'string',default:'worker'},budgets:{type:'string',default:'100,500'},rounds:{type:'string',default:'1'},
}});
assert.ok(args.baseline&&args.candidate&&args.fixtures);
assert.ok(['worker','exact-incumbent'].includes(args.mode));
const jsonl=file=>readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
const fixtures=jsonl(args.fixtures);
const heldout=args.heldout?jsonl(args.heldout):[];
const budgets=args.budgets.split(',').map(Number);
const rounds=Number(args.rounds);
assert.ok(Number.isSafeInteger(rounds)&&rounds>0&&budgets.every(x=>Number.isSafeInteger(x)&&x>0));
const log=data=>console.log(JSON.stringify(data));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function asset(name,path){
  const directory=resolve(path);
  const wasm=readFileSync(resolve(directory,'rsshogi_nnue_mini.wasm'));
  const worker=resolve(directory,'worker.js');
  return {name,directory,wasm,worker,manifest:{wasm:sha(wasm),worker:sha(readFileSync(worker))}};
}
const engines=[asset('baseline',args.baseline),asset('guard',args.candidate)];
log({event:'config',mode:args.mode,budgets,rounds,fixturesSha256:sha(readFileSync(args.fixtures)),
  heldoutSha256:args.heldout?sha(readFileSync(args.heldout)):null,node:process.version,
  engines:engines.map(x=>({name:x.name,...x.manifest}))});
function request(engine,fields){
  const reply=engine.request(fields);
  assert.ok(reply.ok,reply.error);
  return reply.result??reply;
}
if(args.mode==='exact-incumbent'){
  const sdk=engines[1];
  const {MiniEngine}=await import(pathToFileURL(resolve(sdk.directory,'mini.js')));
  const engine=await MiniEngine.create(sdk.wasm);
  try {
    request(engine,{command:'load_embedded'});
    request(engine,{command:'configure',hash_mb:16,threads:1});
    for(const p of fixtures){
      request(engine,{command:'set_obstacle_position',sfen:p.sfen,holes:p.holes});
      assert.deepEqual(request(engine,{command:'legal_moves'}).sort(),p.available.slice().sort());
      request(engine,{command:'search',depth:4,nodes:5000});
      for(const budget of budgets){
        const base={command:'obstacle_root_guard',bestmove:p.referencePlayed,movetime_ms:budget};
        const proof=request(engine,base);
        const result=request(engine,{...base,allow_replacement:true});
        log({event:'incumbent',id:p.id,budget,bad:p.referencePlayed,proof,result,oracleSafe:p.goodMoves.includes(result.bestmove)});
      }
    }
  }finally{engine.dispose();}
}else{
  function createThread(sdk){
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      globalThis.self=globalThis;globalThis.postMessage=x=>parentPort.postMessage(x);
      const loaded=import(workerData);
      parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
    `,{eval:true,workerData:pathToFileURL(sdk.worker).href});
    let counter=0;
    function send(command,fields={}){
      const id=++counter;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(Error(command+' timeout')),10000);
        function finish(error,result){clearTimeout(timer);worker.off('message',receive);worker.off('error',finish);if(error)reject(error);else resolve(result);}
        function receive(reply){if(reply.id===id&&reply.event!=='info')finish(reply.ok?null:Error(reply.error),reply.result);}
        worker.on('message',receive);worker.on('error',finish);worker.postMessage({id,command,...fields});
      });
    }
    return {...sdk,send,close:()=>worker.terminate()};
  }
  const active=engines.map(createThread);
  const results=[];
  async function trial(engine,p,budget){
    await engine.send('new_game');
    await engine.send('position',{sfen:p.sfen,holes:p.holes});
    assert.deepEqual((await engine.send('legalMoves')).sort(),p.available.slice().sort(),p.id);
    const start=performance.now();
    const result=await engine.send('go',{depth:64,movetime_ms:budget});
    const elapsed=performance.now()-start;
    return {name:engine.name,move:result.bestmove,correct:p.goodMoves.includes(result.bestmove),
      legal:p.available.includes(result.bestmove)||!p.available.length&&result.bestmove==='resign',
      elapsed,depth:result.depth,nodes:result.nodes,guard:result.guard??null};
  }
  try{
    for(const e of active){await e.send('init',{wasm:e.wasm,hash_mb:16});await trial(e,fixtures[0],100);}
    for(const budget of budgets) for(let round=0;round<rounds;round++){
      for(const [i,p] of [...fixtures,...heldout].entries()){
        const order=(i+round)%2?[1,0]:[0,1];
        for(const index of order){
          const result={event:'trial',id:p.id,kind:p.kind,category:p.category,budget,round,...await trial(active[index],p,budget)};
          log(result);results.push(result);
        }
      }
    }
  }finally{await Promise.all(active.map(e=>e.close()));}
  for(const budget of budgets) for(const engine of engines){
    const all=results.filter(r=>r.budget===budget&&r.name===engine.name);
    const archived=all.filter(r=>fixtures.some(p=>p.id===r.id));
    const reserve=all.filter(r=>r.guard);
    log({event:'summary',name:engine.name,budget,rounds,trials:all.length,correct:all.filter(r=>r.correct).length,
      archived:archived.length,archivedCorrect:archived.filter(r=>r.correct).length,illegal:all.filter(r=>!r.legal).length,
      guardStatuses:Object.fromEntries([...Map.groupBy(reserve,r=>r.guard.status)].map(([key,x])=>[key,x.length])),
      overBudget50:all.filter(r=>r.elapsed>budget+50).length,
      meanMs:all.reduce((sum,r)=>sum+r.elapsed,0)/all.length,meanDepth:all.reduce((sum,r)=>sum+r.depth,0)/all.length});
  }
}
