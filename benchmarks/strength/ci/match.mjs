import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {planTurn} from './clock-budget.mjs';
import {chooseAdaptiveThink} from './adaptive-think-policy.mjs';
const [binary, sdk, budgetStr='100', capStr='20', pairsStr='1', offsetStr='0', baseline, mode='obstacle', customFixture, opponentBudgetStr=budgetStr, candidateDivisorStr='20', opponentDivisorStr='20', candidatePreDelayStr='0', opponentPreDelayStr='0',candidatePolicy='fixed']=process.argv.slice(2);
const budget=Number(budgetStr), opponentBudget=Number(opponentBudgetStr), cap=Number(capStr), pairs=Number(pairsStr), offset=Number(offsetStr);
const candidateDivisor=Number(candidateDivisorStr), opponentDivisor=Number(opponentDivisorStr);
const candidatePreDelay=Number(candidatePreDelayStr), opponentPreDelay=Number(opponentPreDelayStr);
assert.ok([100,500,1000,1500,3000,6000].includes(budget),'Candidate time budget must be a configured or experimental tier');
assert.ok([100,500,1000,1500,3000,6000].includes(opponentBudget),'Opponent time budget must be configured or experimental tier');
assert.ok(Number.isInteger(cap)&&cap>=1&&cap<=300, 'Ply cap must be within 1–300');
assert.ok(Number.isInteger(pairs)&&pairs>=1&&pairs<=6&&Number.isInteger(offset)&&offset>=0);
assert.ok(['normal','normal-worker','obstacle'].includes(mode));
assert.ok(['fixed','adaptive-feature-v1'].includes(candidatePolicy),'Unknown candidate thinking policy');
assert.ok(candidatePolicy==='fixed'||!normal,'Tactical adaptive benchmark currently validates obstacle boards only');
assert.ok(candidatePolicy==='fixed'||budget===6000,'Adaptive policy requires max 6000ms');
for(const divisor of [candidateDivisor,opponentDivisor])assert.ok(Number.isInteger(divisor)&&divisor>=2&&divisor<=100);
for(const delay of [candidatePreDelay,opponentPreDelay])assert.ok(Number.isFinite(delay)&&delay>=0&&delay<=10000);
const normal=mode==='normal'||mode==='normal-worker';
const raw=readFileSync(customFixture ? resolve(customFixture) :
 new URL(normal?'../experiments/normal-continuous/expansion/openings.jsonl':'../experiments/holdout-openings.jsonl',import.meta.url),'utf8');
const fixtures=raw.trim().split('\n').map(JSON.parse).filter(f=>!normal||f.event==='opening').map(f=>normal?{...f,kind:f.family,sfen:f.opening,holes:[]}:f);
const ids=[...new Set(fixtures.map(f=>f.pair))].slice(offset,offset+pairs);
assert.equal(ids.length,pairs,'Missing requested opening families');
if(!normal)for(const id of ids)assert.deepEqual(
 fixtures.filter(f=>f.pair===id).map(f=>f.kind).sort(),['blackhole','pit'],
 'Each paired opening family must contain pit and blackhole boards');
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
function engine(dir,continuous=false){
  const wasm=readFileSync(resolve(dir,'rsshogi_nnue_mini.wasm'));
  // Legacy 'normal' mode deliberately keeps the old historical Worker used
  // by the continuous-normal benchmark; 'normal-worker' compares the actual
  // supplied SDK Workers without substituting either Worker implementation.
  const js=continuous&&mode==='normal'
    ?resolve(new URL('../experiments/normal-continuous/expansion/continuous-worker.mjs',import.meta.url).pathname)
    :resolve(dir,'worker.js');
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
  return {send,thread,wasm,moduleUrl:pathToFileURL(resolve(dir,'mini.js')).href,sha:hash(wasm),workerSha:hash(readFileSync(js))};
}
const a=engine(sdk,normal), b=baseline?engine(baseline):null;
const scores=[];
try{
  for(const e of [a,b].filter(Boolean))await e.send('init',{wasm:e.wasm,hash_mb:16,moduleUrl:e.moduleUrl});
  log('config',{budget,opponentBudget,cap,pairs,offset,fixtureSha:hash(raw),candidateSha:a.sha,candidateWorkerSha:a.workerSha,baselineSha:b?.sha,baselineWorkerSha:b?.workerSha,referenceSha:hash(readFileSync(binary)),node:process.version,opponent:b?'baseline':'reference',clockMs:180000,candidateClockDivisor:candidateDivisor,opponentClockDivisor:opponentDivisor,candidatePreMoveDelayMs:candidatePreDelay,opponentPreMoveDelayMs:opponentPreDelay,clockDelayMethod:'virtual-debit-not-wall-wait',candidatePolicy});
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
        const isCandidate=side===candidateSide;
        // Measure independent tactical features at each candidate turn.
        // Charge feature-detection work to the candidate's own 3-minute clock.
        // This prototype is NOT wired into the production game.
        const clockBeforeFeatureMs=clocks[side];
        let featureDetectionMs=0, adaptiveDecision=null, tacticalFeatures=null;
        if(isCandidate&&candidatePolicy==='adaptive-feature-v1'){
          const featureStarted=performance.now();
          tacticalFeatures=await request('features',sfen,holes);
          featureDetectionMs=performance.now()-featureStarted;
          clocks[side]-=featureDetectionMs;
          assert.equal(tacticalFeatures.legalCount,legal.length,
            'Independent feature extractor must use same legal move set');
          if(clocks[side]<=0){winner=1-side;reason='clock';break;}
          adaptiveDecision=chooseAdaptiveThink(tacticalFeatures,clocks[side]);
        }
        const currentBudget=isCandidate?(adaptiveDecision?.maxThinkMs??budget):opponentBudget;
        const clockDivisor=isCandidate?candidateDivisor:opponentDivisor;
        const preDelayMs=isCandidate?candidatePreDelay:opponentPreDelay;
        const plan=planTurn({remainingMs:clocks[side],nominalMs:currentBudget,
          divisor:clockDivisor,preMoveDelayMs:preDelayMs});
        clocks[side]-=plan.preMoveDelayChargedMs;
        if(clocks[side]<=0){winner=1-side;reason='clock';break;}
        const ms=plan.searchMs;
        if(e){
          await e.send('position',{sfen,holes:f.holes,moves:[]});
          if(!normal){const sdkLegal=await e.send('legalMoves');
          assert.deepEqual((Array.isArray(sdkLegal)?sdkLegal:sdkLegal.result).slice().sort(),legal,'Legal move set mismatch: '+sfen);}
        }
        const started=performance.now();
        let result;
        try{result=e?await e.send('go',{depth:64,movetime_ms:ms},ms+1750):await request('go',ms,sfen,holes);}
        catch(error){throw Error('Search failed: '+error.message);}
        const elapsed=performance.now()-started;
        clocks[side]-=elapsed;
        turns.push({side,engine:side===candidateSide?'candidate':'opponent',sfenBefore:sfen,move:result.bestmove,depth:result.depth,nodes:result.nodes,elapsed,requestMs:ms,
          clockDivisor,preMoveDelayChargedMs:plan.preMoveDelayChargedMs,
          chargedMs:plan.preMoveDelayChargedMs+elapsed,clockBeforeMs:plan.clockBeforeMs,
          clockAfterDelayMs:plan.clockAfterDelayMs,clockAfterTurnMs:clocks[side],
          clockBeforeFeatureMs,featureDetectionMs,policyDecision:adaptiveDecision,
          tacticalFeatures});
        if(clocks[side]<=0){winner=1-side;reason='clock';break;}
        if(result.bestmove==='resign'){winner=1-side;reason='resign';break;}
        assert.ok(legal.includes(result.bestmove),'Illegal move '+result.bestmove+' in '+sfen);
        sfen=(await request('step',sfen,holes,result.bestmove)).sfen;
      }
      const row={pair:f.pair,kind:f.kind,candidateSide,start:f.sfen,holes:f.holes,winner,reason,turns,clocks};
      scores.push(row);log('game',row);
    }
  }
  for(const kind of (normal?['hirate','game']:['pit','blackhole'])){
    const rows=scores.filter(r=>r.kind===kind);
    assert.equal(rows.length,pairs*2);
    log('summary',{kind,games:rows.length,wins:rows.filter(r=>r.winner===r.candidateSide).length,losses:rows.filter(r=>r.winner!==null&&r.winner!==r.candidateSide).length,undecided:rows.filter(r=>r.winner===null).length});
  }
}finally{
  ref.kill();await Promise.all([a,b].filter(Boolean).map(e=>e.thread.terminate()));
}
