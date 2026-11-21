import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
const {MiniEngine} = await import(strengthFileURL(strengthJoin(strengthSdk, 'mini.js')));
import {gainScore, legal, play, positionFromSfen} from '../../tactics/rules.mjs';
const {toUsi,toSfen} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
const folder=strengthSdk;
const wasm=readFileSync(`${folder}/rsshogi_nnue_mini.wasm`);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(wasm),'0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108');
const readJsonl=path=>readFileSync(`${strengthArchive}/tactics/${path}`,'utf-8').trim().split('\n').map(JSON.parse);
const corpus=readJsonl('corpus.jsonl');
const trials=readJsonl('worker-results.jsonl');
const persistent=corpus.map(item=>({...item,failed:trials.filter(t=>t.id===item.id&&!t.success)})).filter(item=>item.failed.length===3);
const log=(event,data)=>console.log(JSON.stringify({event,...data}));
const engine=await MiniEngine.create(wasm);
const req=(command,args={})=>{
  const result=engine.request({command,...args});
  if(!result.ok)throw Error(command+': '+result.error);
  return result;
};
const reset=()=>req('new_game');
req('load_embedded');req('configure',{threads:1,hash_mb:16});
function set(item,holes=item.holes){return engine.request({command:'set_obstacle_position',holes,sfen:item.sfen});}
function setOrThrow(item){const result=set(item);if(!result.ok)throw Error(result.error);}
function positionStats(item,holes) {
  const response=set(item,holes);
  if(!response.ok)return {error:response.error};
  return {eval:req('evaluate').score,legal:req('legal_moves').result.length};
}
function childItem(item,move) {
  const parent=positionFromSfen(item.sfen,item.holes);
  const found=legal(parent).find(m=>toUsi(m)===move);
  if(!found)throw Error('illegal diagnostic branch '+move);
  return {sfen:toSfen(play(parent,found),{allowHoles:true}),holes:item.holes};
}
function runDirect(item,opts){
  reset();setOrThrow(item);
  const started=performance.now();
  return {...req('search',opts).result,wall:performance.now()-started};
}
const chosen=item=>[...new Set([...item.goodMoves,...item.failed.map(t=>t.move)])];
log('config',{wasm:digest(wasm),worker:digest(readFileSync(`${folder}/worker.js`)),node:process.version});
if(process.argv[2]==='eval'){
  for(const item of corpus){
    const off=positionStats(item,[]);const on=positionStats(item,item.holes);
    log('eval',{id:item.id,on,off,same:!off.error&&!on.error&&off.eval===on.eval});
  }
  for(const item of persistent){
    const gain=gainScore(positionFromSfen(item.sfen,item.holes));
    for(const move of chosen(item)){
      const child=childItem(item,move);
      log('child_eval',{id:item.id,move,good:item.goodMoves.includes(move),gain:gain.scores[move]??null,
        child,on:positionStats(child,item.holes),off:positionStats(child,[])});
    }
  }
} else if(process.argv[2]==='fixed'){
  for(const item of persistent.filter(item=>item.category==='material-gain')){
    for(const depth of [1,3,5,7,9]){
      const opts={depth,nodes:120000};
      log('root_fixed',{id:item.id,depth,result:runDirect(item,opts)});
      if(depth>=3)for(const move of chosen(item)){
        const result=runDirect(childItem(item,move),{...opts,depth:depth-1});
        log('forced_fixed',{id:item.id,depth,move,good:item.goodMoves.includes(move),result,
          rootScore:-result.score,pv:[move,...result.pv]});
      }
    }
  }
} else if(process.argv[2]==='worker'){
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    globalThis.self=globalThis;
    globalThis.postMessage=x=>parentPort.postMessage(x);
    const loaded=import(workerData);
    parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
  `,{eval:true,workerData:`file://${folder}/worker.js`});
  let sequence=0;
  function send(command,args={}){
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const info=[];const started=performance.now();
      const timeout=setTimeout(()=>complete(Error(command+' timeout')),10000);
      function complete(error,result){
        clearTimeout(timeout);worker.off('message',event);worker.off('error',complete);
        if(error)reject(error);else resolve({result,info,wall:performance.now()-started});
      }
      function event(message){
        if(message.id!==id)return;
        if(message.event==='info'){info.push(message.result);return;}
        complete(message.ok?null:Error(message.error),message.result);
      }
      worker.on('message',event);worker.on('error',complete);worker.postMessage({id,command,...args});
    });
  }
  try{
    await send('init',{wasm,hash_mb:16});
    const warm=corpus.find(item=>item.category==='material-gain');
    await send('position',{sfen:warm.sfen,holes:warm.holes});await send('go',{depth:64,movetime_ms:100});
    runDirect(warm,{depth:64,movetime_ms:100});
    const cases=persistent.filter(item=>item.category==='material-gain');
    cases.push(persistent.find(item=>item.id==='blackhole/ray-blocking/01'));
    for(const [index,item] of cases.entries()) for(const budget of [100,500,1500]){
      const oneCase={id:item.id,sfen:item.sfen,holes:item.holes,goodMoves:item.goodMoves,category:item.category};
      async function live(){
        await send('new_game');await send('position',{sfen:item.sfen,holes:item.holes});return send('go',{depth:64,movetime_ms:budget});
      }
      let direct,sliced;
      if(index%2){direct=runDirect(item,{depth:64,movetime_ms:budget});sliced=await live();}
      else {sliced=await live();direct=runDirect(item,{depth:64,movetime_ms:budget});}
      log('worker_comparison',{...oneCase,budget,direct,sliced});
    }
  }finally{await worker.terminate();}
} else throw Error('mode: eval | fixed | worker');
engine.dispose();
