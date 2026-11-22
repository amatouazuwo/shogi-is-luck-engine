import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
const [binary, sdk, budgetStr='100', capStr='20', pairsStr='1', offsetStr='0', baseline]=process.argv.slice(2);
const budget=Number(budgetStr), cap=Number(capStr), pairs=Number(pairsStr), offset=Number(offsetStr);
assert.ok([100,500,1500].includes(budget));
assert.ok(Number.isInteger(cap)&&cap>=1&&cap<=180);
assert.ok(Number.isInteger(pairs)&&pairs>=1&&pairs<=6&&Number.isInteger(offset)&&offset>=0&&offset+pairs<=6);
const raw=readFileSync(new URL('../experiments/holdout-openings.jsonl',import.meta.url),'utf8');
const fixtures=raw.trim().split('\n').map(JSON.parse);
const ids=[...new Set(fixtures.map(f=>f.pair))].slice(offset,offset+pairs);
const hash=b=>createHash('sha256').update(b).digest('hex');
const log=(event,data)=>console.log(JSON.stringify({event,...data}));
const ref=spawn(binary,[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:ref.stdout})[Symbol.asyncIterator]();
async function request(...fields){
  ref.stdin.write(fields.join('\t')+'\n');
  let timer;
  try{
    const r=await Promise.race([lines.next(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('referee timeout')),10000))]);
    assert.ok(!r.done);const x=JSON.parse(r.value);assert.ok(!x.error,x.error);return x;
  }finally{clearTimeout(timer);}
}
function engine(dir){
  const wasm=readFileSync(resolve(dir,'rsshogi_nnue_mini.wasm'));
  const js=resolve(dir,'worker.js');
  const thread=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    globalThis.self=globalThis;
    globalThis.postMessage=x=>parentPort.postMessage(x);
    const loaded=import(workerData);
    parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
  `,{eval:true,workerData:pathToFileURL(js).href});
  let seq=0, failure;
  thread.on('error',e=>{failure=e});
  function send(command,fields={},ms=10000){
    if(failure)throw failure;
    const id=++seq;
    return new Promise((res,rej)=>{
      const finish=(err,value)=>{clearTimeout(timer);thread.off('message',receive);thread.off('error',onError);err?rej(err):res(value)};
      const onError=e=>finish(e);
      const receive=m=>{if(m.id===id&&m.event!=='info')finish(m.ok===false?Error(m.error):null,m.result)};
      const timer=setTimeout(()=>finish(Error(command+' timeout')),ms);
      thread.on('message',receive);thread.on('error',onError);
      thread.postMessage({id,command,...fields});
    });
  }
  return {send,thread,wasm,sha:hash(wasm),workerSha:hash(readFileSync(js))};
}
const a=engine(sdk), b=baseline?engine(baseline):null;
const scores=[];
try{
  for(const e of [a,b].filter(Boolean))await e.send('init',{wasm:e.wasm,hash_mb:16});
  log('config',{budget,cap,pairs,offset,fixtureSha:hash(raw),candidateSha:a.sha,candidateWorkerSha:a.workerSha,baselineSha:b?.sha,baselineWorkerSha:b?.workerSha,referenceSha:hash(readFileSync(binary)),node:process.version,opponent:b?'baseline':'reference',clockMs:180000});
  for(const f of fixtures.filter(f=>ids.includes(f.pair))){
    const holes=f.holes.join(',');
    const first=await request('legal',f.sfen,holes);
    assert.equal(first.moves.length,f.legal,'Archived opening legal count differs');
    for(const candidateSide of [0,1]){
      await request('reset');
      for(const e of [a,b].filter(Boolean))await e.send('new_game');
      let sfen=f.sfen, winner=null, reason='ply-cap';
      const clocks=[180000,180000], turns=[],seen=new Map();
      for(let ply=0;ply<=cap;ply++){
        const side=sfen.split(' ')[1]==='b'?0:1;
        const legal=(await request('legal',sfen,holes)).moves.sort();
        const key=sfen.split(' ').slice(0,3).join(' ');
        seen.set(key,(seen.get(key)||0)+1);
        if(!legal.length){winner=1-side;reason='no-legal';break;}
        if(seen.get(key)>=4){reason='repetition-unadjudicated';break;}
        if(ply===cap)break;
        const e=side===candidateSide?a:b;
        const ms=Math.max(1,Math.min(budget,Math.floor(clocks[side]/20),clocks[side]-150));
        if(e){
          await e.send('position',{sfen,holes:f.holes,moves:[]});
        }
        const started=performance.now();
        let result;
        try{result=e?await e.send('go',{depth:64,movetime_ms:ms},ms+1750):await request('go',ms,sfen,holes);}
        catch(error){throw Error('Search failed: '+error.message);}
        const elapsed=performance.now()-started;
        clocks[side]-=elapsed;
        turns.push({side,engine:side===candidateSide?'candidate':'opponent',move:result.bestmove,depth:result.depth,nodes:result.nodes,elapsed,requestMs:ms});
        if(clocks[side]<=0){winner=1-side;reason='clock';break;}
        if(result.bestmove==='resign'){winner=1-side;reason='resign';break;}
        assert.ok(legal.includes(result.bestmove),'Illegal move '+result.bestmove+' in '+sfen);
        sfen=(await request('step',sfen,holes,result.bestmove)).sfen;
      }
      const row={pair:f.pair,kind:f.kind,candidateSide,start:f.sfen,holes:f.holes,winner,reason,turns,clocks};
      scores.push(row);log('game',row);
    }
  }
  for(const kind of ['pit','blackhole']){
    const rows=scores.filter(r=>r.kind===kind);
    assert.equal(rows.length,pairs*2);
    log('summary',{kind,games:rows.length,wins:rows.filter(r=>r.winner===r.candidateSide).length,losses:rows.filter(r=>r.winner!==null&&r.winner!==r.candidateSide).length,undecided:rows.filter(r=>r.winner===null).length});
  }
}finally{
  ref.kill();await Promise.all([a,b].filter(Boolean).map(e=>e.thread.terminate()));
}
