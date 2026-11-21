import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MiniEngine} from '/workspace/work/obstacle-sdk/mini.js';
const baseline=new URL('file:///workspace/work/obstacle-sdk/rsshogi_nnue_mini.wasm');
const candidate=new URL('./engine/target/wasm32-unknown-unknown/release/rsshogi_nnue_mini.wasm',import.meta.url);
const pinned=readFileSync(new URL('./positions.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const readJsonl=path=>readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
const extra=readJsonl('/workspace/work/strength/forensics/heldout/heldout-escape.jsonl');
const mode=process.argv[2]??'probe';
const wasm=readFileSync(candidate);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=await MiniEngine.create(wasm);
const reference=mode==='zero'?await MiniEngine.create(readFileSync(baseline)):null;
function req(command, fields={}, e=engine){
 const r=e.request({command,...fields});assert.ok(r.ok,r.error);return r.result??r;
}
function set(p,e=engine){return req('set_obstacle_position',{sfen:p.sfen,holes:p.holes},e);}
function guard(move,budget,allow_replacement=false){
 const start=performance.now();
 const r=req('obstacle_root_guard',{bestmove:move,movetime_ms:budget,allow_replacement});
 return {...r,wall:performance.now()-start};
}
const log=data=>console.log(JSON.stringify(data));
log({event:'config',wasmSha256:sha(wasm),mode,node:process.version});
for(const e of [engine,reference].filter(Boolean)){req('load_embedded',{},e);req('configure',{hash_mb:16,threads:1},e);}
try{
 if(mode==='zero'){
  for(const p of [...pinned,...extra]){
   for(const e of [engine,reference]) {req('new_game',{},e);req('set_position',{sfen:p.sfen},e);}
   const results=[engine,reference].map(e=>{const {elapsed_ms,...result}=req('search',{depth:3,nodes:2048},e);return result;});
   assert.deepEqual(...results,p.id);
  }
  log({event:'zero_mask_check',exact:pinned.length+extra.length});
 }else{
  // Warm Wasm paths with a different legal incumbent and no consumed search state.
  for(const p of pinned){set(p);guard(p.goodMoves[0],20);}
  for(const p of pinned){
   set(p);assert.deepEqual(req('legal_moves').sort(),p.available.slice().sort());
   const controls=mode==='all'?p.available: [p.referencePlayed,p.goodMoves[0],p.goodMoves.at(-1)];
   const budgets=mode==='all'?[35]:[5,10,20,35,60];
   for(const budget of budgets){
    for(const move of controls){
     const result=guard(move,budget, false);
     if(p.goodMoves.includes(move))assert.notEqual(result.status,'proved-loss',p.id);
     log({event:'proof',id:p.id,budget,move,inputExactSafe:p.goodMoves.includes(move),...result});
    }
    if(mode==='all')continue;
    let result=guard(p.referencePlayed,budget,true);
    log({event:'replace',id:p.id,budget,move:p.referencePlayed,outputExactSafe:p.goodMoves.includes(result.bestmove),...result});
    req('search',{depth:4,nodes:7000});
    result=guard(p.referencePlayed,budget,true);
    log({event:'replace_after_search',id:p.id,budget,move:p.referencePlayed,outputExactSafe:p.goodMoves.includes(result.bestmove),...result});
   }
  }
 }
}finally {engine.dispose();reference?.dispose();}
