import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {parseUsiHandshake,referenceSettings,parseUsiBestmove,
 scoreExternalNormalProbe} from './external-usi-calibration-contract.mjs';
import {searchRequest,auditSearch} from './search-control-contract.mjs';

const [, ,referenceArg,cwdArg,sdkArg,refereeArg,corpusArg,outputArg]=process.argv;
assert.ok(referenceArg&&cwdArg&&sdkArg&&refereeArg&&corpusArg,
 'Usage: node external-usi-normal-probe.mjs GIKOU_EXE GIKOU_CWD SDK_DIR REFEREE NORMAL_OPENINGS.jsonl [RESULTS.jsonl]');
const sourceTag='v2.0.2',depth=2,tiers=[500,2000,10000,50000];
const digest=x=>createHash('sha256').update(x).digest('hex');
const ref=spawn(resolve(referenceArg),[],{
 cwd:resolve(cwdArg),stdio:['pipe','pipe','inherit']});
const referee=spawn(resolve(refereeArg),[],{stdio:['pipe','pipe','inherit']});
const refLines=createInterface({input:ref.stdout})[Symbol.asyncIterator]();
const legalLines=createInterface({input:referee.stdout})[Symbol.asyncIterator]();
let done=false;
ref.on('exit',()=>{done=true});
function write(line){assert.ok(!done,'Reference engine exited');ref.stdin.write(line+'\n');}
async function until(iterator,predicate,waitMs=30000){
 let timer;
 try{
   for(let i=0;i<100000;i++){
     const reply=await Promise.race([
       iterator.next(),
       new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('USI/reference timed out')),waitMs)),
     ]);
     clearTimeout(timer);
     assert.ok(!reply.done,'Engine closed protocol stream');
     const line=reply.value.trim();
     if(predicate(line))return line;
   }
   throw Error('Reference emitted excessive protocol output');
 }finally{clearTimeout(timer)}
}
async function refereeLegal(sfen){
 referee.stdin.write('legal\t'+sfen+'\t\n');
 const response=await until(legalLines,()=>true,10000);
 const obj=JSON.parse(response);
 assert.ok(!obj.error&&Array.isArray(obj.moves),'Independent referee legal failure');
 return obj.moves.slice().sort();
}
const sdk=resolve(sdkArg),wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const bootstrap='const {parentPort,workerData}=require("node:worker_threads");'+
 'globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);'+
 'const mod=import(workerData);'+
 'parentPort.on("message",async m=>{await mod;self.onmessage({data:m});});';
const worker=new Worker(bootstrap,{eval:true,
 workerData:pathToFileURL(resolve(sdk,'worker.js')).href});
let seq=0;
function send(command,fields={},timeoutMs=12000){
 const id=++seq;return new Promise((ok,fail)=>{
  const clean=()=>{clearTimeout(timer);worker.off('message',received);worker.off('error',error)};
  const error=e=>{clean();fail(e)};
  const received=m=>{if(m.id!==id||m.event==='info')return;
    clean();m.ok===false?fail(Error(m.error)):ok(m.result);};
  const timer=setTimeout(()=>error(Error('NNUE Worker timeout '+command)),timeoutMs);
  worker.on('message',received);worker.on('error',error);
  worker.postMessage({id,command,...fields});
 });
}
const rows=[];
try{
 write('usi');
 const handshake=[];
 for(let i=0;i<200;i++){
   const line=await until(refLines,()=>true,30000);
   handshake.push(line);
   if(line==='usiok')break;
 }
 const header=parseUsiHandshake(handshake);
 assert.match(header.name,/gikou|技巧/i,'Genuine Gikou identification required');
 const settings=referenceSettings(header,{depth});
 for(const command of settings.commands)write(command);
 write('isready');await until(refLines,s=>s==='readyok',90000);
 write('usinewgame');

 await send('init',{wasm,hash_mb:16},30000);
 const raw=readFileSync(resolve(corpusArg),'utf8');
 const positions=raw.trim().split('\n').map(JSON.parse)
   .filter(x=>x.event==='opening'&&x.family==='hirate'&&x.level===100).slice(0,4);
 assert.equal(positions.length,4,'Need four preserved normal-shogi openings');
 for(const f of positions){
   const sfen=f.opening;
   const legal=await refereeLegal(sfen);
   assert.equal(legal.length,f.legal,'Independent original legal move count mismatch');
   // Critical: only NORMAL no-hole SFEN goes to Gikou.
   write('position sfen '+sfen);
   write('go depth '+depth);
   const refBest=await until(refLines,s=>s.startsWith('bestmove '),30000);
   const referenceMove=parseUsiBestmove(refBest,legal);
   const candidates=[];
   for(const cap of tiers){
     await send('new_game');
     await send('position',{sfen,holes:[],moves:[]});
     const sdkMoves=(await send('legalMoves')).slice().sort();
     assert.deepEqual(sdkMoves,legal,'Normal legal move sets disagree');
     const request=searchRequest({depth:64,nodes:cap,movetime_ms:1000});
     const result=await send('go',request,4000);
     const observed=auditSearch(result,request,legal);
     candidates.push({nodesCap:cap,actualNodes:observed.nodes,
       bestmove:observed.bestmove,actualDepth:observed.depth,
       elapsedMs:observed.elapsed_ms,
       agreesWithReference:observed.bestmove===referenceMove});
   }
   const row={pair:f.pair,sfen,legal,referenceMove,candidates};
   rows.push(row);
   console.log(JSON.stringify({event:'normal-reference-position',...row}));
 }
 const metadata={
   referenceName:header.name,sourceTag,referenceDepth:depth,
   referenceSha256:digest(readFileSync(resolve(referenceArg))),
   rsshogiWasmSha256:digest(wasm),
   referenceEvaluationFileSha256:digest(readFileSync(resolve(cwdArg,'params.bin'))),
   sourceCorpusSha256:digest(raw),
 };
 const summary=scoreExternalNormalProbe(rows,metadata);
 console.log(JSON.stringify({event:'normal-reference-summary',metadata,summary}));
 if(outputArg)writeFileSync(resolve(outputArg),
   [...rows.map(x=>({event:'normal-reference-position',...x})),
    {event:'normal-reference-summary',metadata,summary}]
     .map(JSON.stringify).join('\n')+'\n');
}finally{
 try{write('quit')}catch{}
 ref.kill();referee.kill();await worker.terminate();
}
