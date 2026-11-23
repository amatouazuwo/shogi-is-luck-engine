// Experimental Gikou2 depth/node calibration: never called by the production game.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {parseUsiHandshake,referenceSettings,parseUsiBestmove}
  from './external-usi-calibration-contract.mjs';
import {planTurn} from './clock-budget.mjs';
import {searchRequest,auditSearch} from './search-control-contract.mjs';

const [, ,gikouExe,gikouCwd,sdkArg,refereeExe,corpusArg,
  depthArg='2',tierCsv='1000,2000,4000,7000',idCsv='8,9,10,11,12,13']=process.argv;
assert.ok(gikouExe&&gikouCwd&&sdkArg&&refereeExe&&corpusArg,
 'Usage: node external-usi-normal-match.mjs GIKOU_EXE GIKOU_CWD SDK_DIR REFEREE NORMAL_OPENINGS.jsonl');
const parseUniqueIntegers=(raw,min,max,label)=>{
 const parts=raw.split(',');
 assert.ok(parts.length>=1&&parts.length<=8,'Invalid '+label+' count');
 const numbers=parts.map(s=>{assert.match(s,/^[0-9]+$/,'Invalid '+label+' item');
   return Number(s)});
 assert.ok(numbers.every(n=>Number.isSafeInteger(n)&&n>=min&&n<=max),
   'Invalid '+label+' range');
 assert.equal(new Set(numbers).size,numbers.length,'Duplicate '+label);
 return numbers;
};
const depth=Number(depthArg);
assert.ok(Number.isInteger(depth)&&[2,3,4,5].includes(depth),'External depth must be 2..5');
const gid=parseUniqueIntegers(idCsv,8,15,'fixture');
const nodesTier=parseUniqueIntegers(tierCsv,500,50000,'node');
const maxPlies=300;
const sha=x=>createHash('sha256').update(x).digest('hex');
const gikou=spawn(resolve(gikouExe),[],{cwd:resolve(gikouCwd),
 stdio:['pipe','pipe','inherit']});
const referee=spawn(resolve(refereeExe),[],{stdio:['pipe','pipe','inherit']});
const gikouLines=createInterface({input:gikou.stdout})[Symbol.asyncIterator]();
const legalLines=createInterface({input:referee.stdout})[Symbol.asyncIterator]();
let gikouDead=false;gikou.on('exit',()=>{gikouDead=true});
function write(cmd){assert.ok(!gikouDead,'Gikou2 exited unexpectedly');gikou.stdin.write(cmd+'\n')}
async function readUntil(it,predicate,timeoutMs=30000){
 let timer;
 try{
  for(let i=0;i<100000;i++){
   const r=await Promise.race([it.next(),
    new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Protocol timeout')),timeoutMs))]);
   clearTimeout(timer);
   assert.ok(!r.done,'Protocol stream closed');
   const line=r.value.trim();
   if(predicate(line))return line;
  }
  throw Error('Protocol emitted too much output');
 }finally{clearTimeout(timer)}
}
async function refereeCommand(command,sfen,holes='',move=''){
 referee.stdin.write((command==='step'?[command,sfen,holes,move]:[command,sfen,holes]).join('\t')+'\n');
 const line=await readUntil(legalLines,()=>true,15000);
 const v=JSON.parse(line);assert.ok(!v.error,JSON.stringify(v));
 return v;
}
const sdk=resolve(sdkArg),wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const boot='const {parentPort,workerData}=require("node:worker_threads");'+
 'globalThis.self=globalThis;globalThis.postMessage=x=>parentPort.postMessage(x);'+
 'const loaded=import(workerData);'+
 'parentPort.on("message",async m=>{await loaded;self.onmessage({data:m});});';
const worker=new Worker(boot,{eval:true,
 workerData:pathToFileURL(resolve(sdk,'worker.js')).href});
let seq=0;
function send(command,fields={},timeoutMs=20000){
 const id=++seq;
 return new Promise((ok,fail)=>{
  const clean=()=>{clearTimeout(timer);worker.off('message',receive);worker.off('error',error)};
  const error=e=>{clean();fail(e)};
  const receive=m=>{if(m.id!==id||m.event==='info')return;
   clean();m.ok===false?fail(Error(m.error)):ok(m.result)};
  const timer=setTimeout(()=>error(Error('Native Worker timeout '+command)),timeoutMs);
  worker.on('message',receive);worker.on('error',error);
  worker.postMessage({id,command,...fields});
 });
}
const clock=180000,delayMs=1300,divisor=20,nominal=1000;
const games=[];
try{
 write('usi');
 const handshake=[];
 while(handshake.at(-1)!=='usiok'){
   assert.ok(handshake.length<200,'Invalid Gikou protocol');
   handshake.push(await readUntil(gikouLines,()=>true,30000));
 }
 const identity=parseUsiHandshake(handshake);
 assert.match(identity.name,/gikou|技巧/i);
 const config=referenceSettings(identity,{depth});
 for(const c of config.commands)write(c);
 write('isready');await readUntil(gikouLines,s=>s==='readyok',90000);
 await send('init',{wasm,hash_mb:16},30000);
 const raw=readFileSync(resolve(corpusArg),'utf8');
 const fixtures=raw.trim().split('\n').map(JSON.parse)
   .filter(x=>x.event==='opening'&&x.family==='hirate'&&gid.includes(x.pair));
 assert.equal(fixtures.length,gid.length,'Missing requested normal opening IDs');
 assert.deepEqual(fixtures.map(x=>x.pair).slice().sort((a,b)=>a-b),
   gid.slice().sort((a,b)=>a-b),'Unexpected fixture identities');
 console.log(JSON.stringify({
   event:'gikou-normal-match-config',
   name:identity.name,tag:'v2.0.2',depthLimit:depth,book:false,threads:1,
   referenceHash:sha(readFileSync(resolve(gikouExe))),
   referenceParamsHash:sha(readFileSync(resolve(gikouCwd,'params.bin'))),
   nnueHash:sha(wasm),workerHash:sha(readFileSync(resolve(sdk,'worker.js'))),
   corpusHash:sha(raw),
   fixtureIds:gid,nodeTiers:nodesTier,clockMs:clock,
   nominalStudentMs:nominal,clockDivisor:divisor,preMoveDelayMs:delayMs,
   maxPlies,referenceUsesDepthInsteadOfTimeLimit:true,
   outcomeIfRepetition:'neutral-unadjudicated',
   noHumanRankClaim:true,
 }));
 for(const tier of nodesTier)for(const f of fixtures)for(const candidateSide of [0,1]){
   // Every game must begin with both engines' state reset.
   await send('new_game');
   write('usinewgame');
   let sfen=f.opening;
   const clocks=[clock,clock],history=new Map(),turns=[];
   let winner=null,reason='ply-cap';
   for(let ply=0;ply<=maxPlies;ply++){
     const side=sfen.split(' ')[1]==='b'?0:1;
     const legal=(await refereeCommand('legal',sfen)).moves.sort();
     const key=sfen.split(' ').slice(0,3).join(' ');
     history.set(key,(history.get(key)||0)+1);
     if(!legal.length){winner=1-side;reason='no-legal';break}
     if(history.get(key)>=4){reason='repetition-unadjudicated';break}
     if(ply===maxPlies)break;
     const isCandidate=side===candidateSide;
     const plan=planTurn({remainingMs:clocks[side],
       nominalMs:nominal,divisor,preMoveDelayMs:delayMs});
     clocks[side]-=plan.preMoveDelayChargedMs;
     if(clocks[side]<=0){winner=1-side;reason='clock';break}
     let bestmove,result=null;
     const start=performance.now();
     if(isCandidate){
       await send('position',{sfen,holes:[],moves:[]});
       const available=(await send('legalMoves')).slice().sort();
       assert.deepEqual(available,legal,'Official referee and NNUE legal sets diverged');
       const search=searchRequest({depth:64,nodes:tier,movetime_ms:plan.searchMs});
       result=await send('go',search,plan.searchMs+1750);
       bestmove=result.bestmove;
       if(bestmove!=='resign')auditSearch(result,search,legal);
     }else{
       write('position sfen '+sfen);
       write('go depth '+depth);
       const response=await readUntil(gikouLines,x=>x.startsWith('bestmove '),15000);
       bestmove=response.split(/\s+/)[1];
       if(bestmove!=='resign'&&bestmove!=='win')
         parseUsiBestmove(response,legal);
     }
     const elapsed=performance.now()-start;
     clocks[side]-=elapsed;
     turns.push({
       ply,side,engine:isCandidate?'rsshogi':'gikou2',
       sfenBefore:sfen,move:bestmove,elapsedMs:elapsed,
       depth:result?.depth??null,nodes:result?.nodes??null,
       nodeCap:isCandidate?tier:null,
       studentRequestMs:isCandidate?plan.searchMs:null,
       chargedMs:elapsed+plan.preMoveDelayChargedMs,
       clockBeforeMs:plan.clockBeforeMs,
       clockAfterTurnMs:clocks[side],
     });
     if(clocks[side]<=0){winner=1-side;reason='clock';break}
     if(bestmove==='resign'){winner=1-side;reason='resign';break}
     if(bestmove==='win'){reason='unsupported-entering-king';break}
     assert.ok(legal.includes(bestmove),'Illegal USI move');
     sfen=(await refereeCommand('step',sfen,'',bestmove)).sfen;
   }
   const row={event:'gikou-normal-match-game',nodesCap:tier,
     pair:f.pair,candidateSide,start:f.opening,clocks,winner,reason,turns};
   games.push(row);
   console.log(JSON.stringify(row));
 }
 for(const tier of nodesTier){
   const data=games.filter(g=>g.nodesCap===tier);
   assert.equal(data.length,gid.length*2);
   const wins=data.filter(g=>g.winner===g.candidateSide).length;
   const losses=data.filter(g=>g.winner!==null&&g.winner!==g.candidateSide).length;
   const neutral=data.filter(g=>g.winner===null).length;
   const result={
     event:'gikou-normal-match-summary',depthLimit:depth,nodesCap:tier,games:data.length,
     rsshogiWins:wins,gikouWins:losses,neutralUndecided:neutral,
     scoreBoundsIncludingNeutral:[Math.round(wins/data.length*10000)/10000,
       Math.round((wins+neutral)/data.length*10000)/10000],
     reasons:Object.fromEntries([...new Set(data.map(g=>g.reason))]
       .map(reason=>[reason,data.filter(g=>g.reason===reason).length])),
     externallyCertifiedAmateurGrade:false,
     caution:'Exploratory paired normal-shogi match; opening families and color swaps '+
       'are correlated. Gikou2 depth is NOT an independently certified human amateur grade. '+
       'The Gikou reference uses a depth limit while NNUE uses a node+time cap.',
   };
   console.log(JSON.stringify(result));
 }
}finally{
 try{write('quit')}catch{}
 gikou.kill();referee.kill();await worker.terminate();
}
