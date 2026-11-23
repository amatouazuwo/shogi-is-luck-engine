import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/ci/tactical-delta.mjs');
const base={event:'config',positions:3,corpusSha256:'same',wasmSha256:'w',workerSha256:'worker'};
function trial(id,success,move='x',category='ray-blocking'){return {event:'trial',id,kind:'pit',category,budget:100,success,move,legal:true,timeout:false};}
function run(candidate,baseline,alter=false){
 const cwd=mkdtempSync(join(tmpdir(),'tactical-delta-test-'));
 try {
  writeFileSync(join(cwd,'candidate.jsonl'),[base,...candidate].map(JSON.stringify).join('\n')+'\n');
  writeFileSync(join(cwd,'baseline.jsonl'),[{...base,corpusSha256:alter?'other':'same'},...baseline].map(JSON.stringify).join('\n')+'\n');
  const p=spawnSync(process.execPath,[script,'candidate.jsonl','baseline.jsonl'],{cwd,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}});
  const output=p.status===0?JSON.parse(readFileSync(join(cwd,'results/tactical-delta.json'),'utf8')):null;
  return {p,output};
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
const old=[trial('one',false),trial('two',true),trial('three',false,'x','material-gain')];
const now=[trial('one',true),trial('two',false),trial('three',false,'x','material-gain')];
test('retains fixed and regressed identities in the same category',()=>{
 const {p,output}=run(now,old);
 assert.equal(p.status,0,p.stderr);
 assert.equal(output.total,3);
 const ray=output.byCategory.find(x=>x.category==='ray-blocking');
 assert.deepEqual([ray.improved,ray.regressed,ray.candidateCorrect,ray.baselineCorrect],[1,1,1,1]);
 assert.deepEqual(output.changedProblems.map(x=>x.change),['improved','regressed']);
});
test('refuses different corpora',()=>{
 const {p}=run(now,old,true);assert.notEqual(p.status,0);assert.match(p.stderr,/Different corpora/);
});
test('refuses a missing test position',()=>{
 const {p}=run(now,old.slice(0,2));assert.notEqual(p.status,0);assert.match(p.stderr,/Every target-budget position/);
});
test('refuses an illegal search result',()=>{
 const broken=[...now];broken[0]={...broken[0],legal:false};
 const {p}=run(broken,old);assert.notEqual(p.status,0);assert.match(p.stderr,/Illegal or failed/);
});
