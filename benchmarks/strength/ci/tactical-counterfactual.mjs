import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// This is a diagnostic, NOT a sound alternative-move proof.
// After each actual / label-good root choice, give the opponent the same
// fresh engine, position, budget and independent legal-move validation.
const [referee,sdk,trialFile,corpusFile]=process.argv.slice(2);
assert.ok(referee&&sdk&&trialFile&&corpusFile,
  'Usage: node tactical-counterfactual.mjs REFEREE SDK tactical-candidate.jsonl corpus.jsonl');
const trials=readFileSync(trialFile,'utf8').trim().split('\n').map(JSON.parse);
const config=trials.find(x=>x.event==='config');
assert.ok(config);
const missed=trials.filter(x=>x.event==='trial'&&x.budget===100&&x.category==='ray-blocking'&&!x.success);
assert.ok(missed.length>0,'Expected some ray-blocking misses');
const fixtures=new Map(readFileSync(corpusFile,'utf8').trim().split('\n').map(JSON.parse).map(x=>[x.id,x]));
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const workerJs=resolve(sdk,'worker.js');
const ref=spawn(referee,[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:ref.stdout})[Symbol.asyncIterator]();
async function refereeRequest(...args) {
 ref.stdin.write(args.join('\t')+'\n');
 let timer;
 try {
  const x=await Promise.race([lines.next(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Referee timeout')),10000))]);
  assert.equal(x.done,false,'Independent referee closed');
  const result=JSON.parse(x.value);
  assert.ok(!result.error,'Referee error: '+args[0]);
  return result;
 }finally{clearTimeout(timer);}
}
const worker=new Worker(`
 const {parentPort,workerData}=require('node:worker_threads');
 globalThis.self=globalThis;
 globalThis.postMessage=value=>parentPort.postMessage(value);
 const loaded=import(workerData);
 parentPort.on('message',async data=>{await loaded;self.onmessage({data});});
`,{eval:true,workerData:pathToFileURL(workerJs).href});
let seq=0, failure;
worker.on('error',error=>{failure=error});
async function send(command,fields={},timeoutMs=10000){
 if(failure)throw failure;
 const id=++seq;
 return new Promise((res,rej)=>{
  const done=(err,val)=>{clearTimeout(timer);worker.off('message',receive);worker.off('error',onError);err?rej(err):res(val)};
  const receive=message=>{if(message.id===id&&message.event!=='info')done(message.ok===false?Error(message.error):null,message.result)};
  const onError=error=>done(error);
  const timer=setTimeout(()=>done(Error(command+' timeout')),timeoutMs);
  worker.on('message',receive);worker.on('error',onError);
  worker.postMessage({id,command,...fields});
 });
}
const records=[], replyMs=500;
try{
 await send('init',{wasm,hash_mb:16},15000);
 for(const entry of missed) {
  const item=fixtures.get(entry.id);
  assert.ok(item,'Unknown tactical item '+entry.id);
  assert.equal(item.category,'ray-blocking');
  assert.ok(item.available.includes(entry.move),'Trial move not independently published legal');
  assert.ok(item.goodMoves.length>0,'No labelled alternatives');
  const chosen=item.goodMoves.slice().sort()[0];
  assert.ok(item.available.includes(chosen));
  const holes=item.holes.join(',');
  const legal=(await refereeRequest('legal',item.sfen,holes)).moves;
  assert.deepEqual(legal.slice().sort(),item.available.slice().sort(),'Rule mismatch at '+entry.id);
  const options=[{kind:'played',move:entry.move},{kind:'labelled',move:chosen}];
  const branches=[];
  for(const option of options) {
   const after=(await refereeRequest('step',item.sfen,holes,option.move)).sfen;
   const replies=(await refereeRequest('legal',after,holes)).moves;
   await send('new_game');
   await send('position',{sfen:after,holes:item.holes,moves:[]});
   const result=await send('go',{depth:64,movetime_ms:replyMs},replyMs+2000);
   assert.ok((replies.length===0&&result.bestmove==='resign')||replies.includes(result.bestmove),
      'Illegal opponent response: '+entry.id+' / '+option.move);
   branches.push({kind:option.kind,move:option.move,afterSfen:after,
      opponentBestmove:result.bestmove,opponentLegalMoves:replies.length,
      opponentScore:Number.isFinite(result.score)?result.score:null,
      opponentDepth:result.depth??null,opponentNodes:result.nodes??null,
      opponentPv:result.pv??null});
  }
  records.push({id:entry.id,kind:item.kind,sfen:item.sfen,holes:item.holes,
    actualMove:entry.move,labelledGoodMove:chosen,
    rootSearchDepth:entry.depth,rootSearchBudgetMs:100,
    branches,scope:'opponent searches after fixed root moves, not fully searched root alternatives'});
 }
}finally{ref.stdin.end();ref.kill();await worker.terminate();}
mkdirSync('results',{recursive:true});
const output={schema:1,corpusSha256:config.corpusSha256,
 sdkWasmSha256:createHash('sha256').update(wasm).digest('hex'),opponentBudgetMs:replyMs,
 caseCount:records.length,cases:records,
 caveats:[
  'The saved tactical labels use a one-reply material metric and do not prove the strongest game move.',
  'Opponent score is engine-dependent and is not a game-theoretic proof. Both branches use identical search limits.',
  'All cases were chosen from archived 100ms misses; this is diagnostic, not fresh holdout evaluation.',
  'Do not change the engine or promote it based on this diagnostic alone.'
 ]};
writeFileSync('results/tactical-counterfactual.json',JSON.stringify(output,null,2)+'\n');
const summaryLines=['## Opponent-side counterfactual tactical diagnostics',
  '| Problem | Actual move | Label move | Opponent score after actual | Opponent score after label |',
  '|---|---|---|---:|---:|',
  ...records.map(x=>'| '+x.id+' | '+x.actualMove+' | '+x.labelledGoodMove+' | '+
   (x.branches[0].opponentScore??'N/A')+' | '+(x.branches[1].opponentScore??'N/A')+' |'),
  'Scores are from the opponent side after each fixed move. NOT a move-quality ranking or a proof.'];
const summary=summaryLines.join('\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
