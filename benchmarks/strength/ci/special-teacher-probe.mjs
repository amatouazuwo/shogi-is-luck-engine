import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {searchRequest,auditSearch} from './search-control-contract.mjs';
import {TRIAL_NODE_TIERS,TEACHER_BUDGET_MS,STUDENT_TIME_CAP_MS,
  auditTeacherDataset} from './special-teacher-contract.mjs';

const [, ,sdkArg,fixtureArg,outArg]=process.argv;
assert.ok(sdkArg&&fixtureArg,
 'Usage: node special-teacher-probe.mjs SDK_DIR HOLDOUT.jsonl [RESULTS.jsonl]');
const sdk=resolve(sdkArg);
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const workerJs=readFileSync(resolve(sdk,'worker.js'));
const sha256=x=>createHash('sha256').update(x).digest('hex');
const source='const {parentPort,workerData}=require("node:worker_threads");'+
 'globalThis.self=globalThis;globalThis.postMessage=x=>parentPort.postMessage(x);'+
 'const ready=import(workerData);'+
 'parentPort.on("message",async m=>{await ready;self.onmessage({data:m});});';
const worker=new Worker(source,{eval:true,
 workerData:pathToFileURL(resolve(sdk,'worker.js')).href});
let seq=0;
function send(command,fields={},deadlineMs=15000){
  const id=++seq;
  return new Promise((ok,fail)=>{
    const clean=()=>{clearTimeout(timer);worker.off('message',received);worker.off('error',failed)};
    const failed=e=>{clean();fail(e)};
    const received=m=>{if(m.id!==id||m.event==='info')return;
      clean();if(m.ok===false)fail(Error(command+': '+m.error));else ok(m.result);};
    const timer=setTimeout(()=>failed(Error('Worker timeout: '+command)),deadlineMs);
    worker.on('message',received);worker.on('error',failed);
    worker.postMessage({id,command,...fields});
  });
}
const fixturesRaw=readFileSync(resolve(fixtureArg),'utf8');
const fixtures=fixturesRaw.trim().split('\n').map(JSON.parse);
assert.equal(fixtures.length,12,'Require archived 12 special positions');
const expectedIds=new Set(['21','22','23','24','25','26']);
const observedIds=new Set(fixtures.map(x=>String(x.pair)));
assert.deepEqual([...observedIds].sort(),[...expectedIds].sort());
const actualRows=[];
const event=(name,row)=>console.log(JSON.stringify({event:name,...row}));
try{
  await send('init',{wasm,hash_mb:16},30000);
  for(const f of fixtures){
    const position={sfen:f.sfen,holes:f.holes,moves:[]};
    // Reset all persistent memory between every *search*, so student
    // access to the teacher's transposition table is impossible.
    await send('new_game');
    await send('position',position);
    const legal=await send('legalMoves');
    assert.equal(legal.length,f.legal,'Fixture legal count differs from real Worker');
    assert.ok(legal.length>=1);
    const teacherRequest=searchRequest({depth:64,movetime_ms:TEACHER_BUDGET_MS});
    const teacherResult=await send('go',teacherRequest,TEACHER_BUDGET_MS+3000);
    const teacherAudit=auditSearch(teacherResult,teacherRequest,legal);
    const teacher={...teacherAudit,requestMs:TEACHER_BUDGET_MS};
    const students=[];
    for(const tier of TRIAL_NODE_TIERS){
      await send('new_game');
      await send('position',position);
      const req=searchRequest({depth:64,nodes:tier,movetime_ms:STUDENT_TIME_CAP_MS});
      const candidate=await send('go',req,STUDENT_TIME_CAP_MS+2500);
      const observed=auditSearch(candidate,req,legal);
      students.push({
        nodeCap:tier,requestMs:STUDENT_TIME_CAP_MS,...observed,
        sameMoveAsTeacher:observed.bestmove===teacher.bestmove,
      });
    }
    const row={pair:f.pair,kind:f.kind,stage:f.stage,sfen:f.sfen,holes:f.holes,
      legal:f.legal,legalMoves:legal.slice().sort(),teacher,students};
    actualRows.push(row);
    event('teacher-position',row);
  }
  const report=auditTeacherDataset(actualRows,fixtures);
  const header={
    event:'teacher-probe-config',
    sdkSha256:sha256(wasm),workerSha256:sha256(workerJs),
    fixtureSha256:sha256(fixturesRaw),source:'archived-holdout-openings',
    teacherBudgetMs:TEACHER_BUDGET_MS,studentBudgetMs:STUDENT_TIME_CAP_MS,
    studentNodeCaps:TRIAL_NODE_TIERS,archivePositions:fixtures.length,
    teacherResetBetweenPositions:true,studentResetBetweenSearches:true,
    externallyCertifiedStrength:false,
  };
  event('teacher-probe-config',header);
  event('teacher-probe-summary',report);
  if(outArg){
    const out=[header,...actualRows.map(x=>({event:'teacher-position',...x})),
      {event:'teacher-probe-summary',...report}];
    writeFileSync(resolve(outArg),out.map(JSON.stringify).join('\n')+'\n');
  }
}finally{await worker.terminate()}
