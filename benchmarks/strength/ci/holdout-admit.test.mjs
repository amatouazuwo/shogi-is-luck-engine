import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/ci/holdout-admit.mjs');
const archive={event:'opening',kind:'pit',sfen:'9/9/9/9/9/9/9/9/9 b - 1',holes:['3e']};
const proposal={...archive,sfen:'9/9/9/9/9/9/9/9/9 w - 2',
  source:'independent-sealed-set',sourceId:'case-1',collectedAt:'2026-11-22T00:00:00Z'};
function run(value) {
 const cwd=mkdtempSync(join(tmpdir(),'admit-test-'));
 try{
  writeFileSync(join(cwd,'old.jsonl'),JSON.stringify(archive)+'\n');
  writeFileSync(join(cwd,'new.jsonl'),JSON.stringify(value)+'\n');
  const p=spawnSync(process.execPath,[script,'new.jsonl','old.jsonl'],{cwd,encoding:'utf8'});
  const output=p.status===0?JSON.parse(readFileSync(join(cwd,'results/holdout-admission.json'),'utf8')):null;
  return {p,output};
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
test('accepts distinct documented candidate only as provisional holdout',()=>{
 const {p,output}=run(proposal);
 assert.equal(p.status,0,p.stderr);
 assert.equal(output.admittedCount,1);
 assert.match(output.warning,/NOT proof/);
});
test('rejects exact archived opening',()=>{
 const {p}=run({...proposal,sfen:archive.sfen});
 assert.notEqual(p.status,0);assert.match(p.stderr,/duplicates an archived/);
});
test('rejects candidate without independent provenance',()=>{
 const {p}=run({...proposal,source:''});
 assert.notEqual(p.status,0);assert.match(p.stderr,/Missing independent origin/);
});
