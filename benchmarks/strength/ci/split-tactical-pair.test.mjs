import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/ci/split-tactical-pair.mjs');
const config={event:'config',positions:2,rounds:1,budgets:[100],corpusSha256:'same',
 sdk:[{name:'candidate',wasmSha256:'new',workerSha256:'worker'},{name:'baseline',wasmSha256:'old',workerSha256:'worker'}]};
const trial=(name,id,correct)=>({event:'trial',name,id,kind:'pit',category:'ray-blocking',budget:100,
 correct,legal:true,timeout:false,move:correct?'good':'bad'});
function run(rows){
 const cwd=mkdtempSync(join(tmpdir(),'split-tactical-'));
 try {
  writeFileSync(join(cwd,'pair.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
  const p=spawnSync(process.execPath,[script,'pair.jsonl'],{cwd,encoding:'utf8'});
  const candidate=p.status===0?readFileSync(join(cwd,'results/tactical-candidate.jsonl'),'utf8').trim().split('\n').map(JSON.parse):null;
  const baseline=p.status===0?readFileSync(join(cwd,'results/tactical-baseline.jsonl'),'utf8').trim().split('\n').map(JSON.parse):null;
  return {p,candidate,baseline};
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
const full=[config,trial('candidate','a',true),trial('baseline','a',false),
 trial('baseline','b',true),trial('candidate','b',false)];
test('splits paired public SDK trials retaining matching IDs and SHA',()=>{
 const {p,candidate,baseline}=run(full);
 assert.equal(p.status,0,p.stderr);
 assert.equal(candidate[0].wasmSha256,'new');
 assert.equal(baseline[0].wasmSha256,'old');
 assert.deepEqual(candidate.slice(1).map(x=>x.id),['a','b']);
 assert.deepEqual(baseline.slice(1).map(x=>x.success),[false,true]);
});
test('fails closed on missing paired trial',()=>{
 const {p}=run(full.slice(0,-1));
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/Incomplete engine trial coverage/);
});
test('fails on duplicate trial ID',()=>{
 const broken=[config,trial('candidate','a',true),trial('candidate','a',false),
  trial('baseline','a',true),trial('baseline','b',false)];
 const {p}=run(broken);
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/Duplicate trial id/);
});
