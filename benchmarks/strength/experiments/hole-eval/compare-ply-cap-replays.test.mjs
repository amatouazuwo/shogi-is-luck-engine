import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script=resolve('benchmarks/strength/experiments/hole-eval/compare-ply-cap-replays.mjs');
const turn=(move,i)=>({move,side:i%2,sfenBefore:'s'+i});
const make=(kind,candidateSide,moves,winner,reason)=>({
 event:'game',pair:30,kind,candidateSide,
 start:'4k4/9/9/9/9/9/9/9/4K4 b - 1',
 holes:kind==='pit'?['5e']:['4e','5e','6e','4f','5f','6f','4g','5g','6g'],
 winner,reason,turns:moves.map(turn)
});
const older=[
 make('pit',0,['a','b'],null,'ply-cap'),
 make('pit',1,['a'],0,'no-legal'),
 make('blackhole',0,['a','b'],null,'ply-cap'),
 make('blackhole',1,['a','b'],null,'ply-cap')
];
const newer=[
 make('pit',0,['a','b','c'],0,'no-legal'),
 make('pit',1,['a','c','d'],null,'ply-cap'),
 make('blackhole',0,['z','b','c'],null,'ply-cap'),
 make('blackhole',1,['a','b'],null,'repetition-unadjudicated')
];
function compare(opts={}){
 const tmp=mkdtempSync(join(tmpdir(),'cap-replay-'));
 try{
  const config=cap=>({event:'config',pairs:1,budget:100,cap,
   fixtureSha:opts.fixtureSha||'same-opening',candidateSha:'wasmA'+cap,baselineSha:'wasmB'+cap});
  const files=[join(tmp,'old.jsonl'),join(tmp,'new.jsonl')],out=join(tmp,'report.json');
  writeFileSync(files[0],[config(2),...(opts.old||older)].map(JSON.stringify).join('\n')+'\n');
  writeFileSync(files[1],[config(3),...(opts.new||newer)].map(JSON.stringify).join('\n')+'\n');
  const p=spawnSync(process.execPath,[script,...files,out],{timeout:5000,encoding:'utf8'});
  return {status:p.status,stderr:p.stderr,report:p.status===0?JSON.parse(readFileSync(out,'utf8')):null};
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
test('observes new games without pretending they continue earlier capped games',()=>{
 const {status,stderr,report}=compare();
 assert.equal(status,0,stderr);
 assert.deepEqual(report.totals,{oldDecided:1,oldUndecided:3,newDecided:1,newUndecided:3,
  oldUndecidedToNewDecided:1,oldDecidedToNewUndecided:1,
  exactFullOldTrace:3,strictContinuations:1,strictContinuationAndNewDecided:1,
  divergedBeforeOldEnd:1});
 assert.equal(report.byBoard.pit.oldUndecided,1);
 assert.equal(report.byBoard.blackhole.newUndecided,2);
 assert.equal(report.equalBinaryHashes,false);
 assert.equal(report.cases.find(x=>x.key==='30/pit/0').strictContinuation,true);
 assert.equal(report.cases.find(x=>x.key==='30/pit/1').strictContinuation,false,
  'A previously finished game cannot be counted as an extended continuation');
 assert.equal(report.cases.find(x=>x.key==='30/blackhole/0').strictContinuation,false);
});
test('rejects a missing color-swapped game',()=>{
 const {status,stderr}=compare({new:newer.slice(1)});
 assert.notEqual(status,0);
 assert.match(stderr,/Incomplete games/);
});
test('rejects a changed starting position without attribution',()=>{
 const mutated=structuredClone(newer);mutated[0].start='different';
 const {status,stderr}=compare({new:mutated});
 assert.notEqual(status,0);
 assert.match(stderr,/Starting position changed/);
});
