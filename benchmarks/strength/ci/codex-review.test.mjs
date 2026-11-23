import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script=resolve('benchmarks/strength/ci/codex-review.mjs');
const mkBranch=(move,played,reply)=>({
 move,played,afterCandidateSfen:'after '+move,
 legalOpponentReplies:reply===null?0:3,
 referenceReply:reply,afterReplySfen:reply===null?null:'after '+reply
});
const mkCase=(pair,branches)=>({
 file:'results/direct.jsonl',kind:'pit',pair,candidateSide:1,candidatePly:7,
 sfen:'start '+pair,holes:['3e'],sourceFixtureSha256:'test',budgetMs:100,branches
});
function run(records) {
 const cwd=mkdtempSync(join(tmpdir(),'codex-review-test-'));
 try{
  writeFileSync(join(cwd,'probes.json'),JSON.stringify({schema:1,records}));
  const p=spawnSync(process.execPath,[script,'probes.json'],{cwd,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}});
  const out=p.status===0?JSON.parse(readFileSync(join(cwd,'results/codex-review.json'),'utf8')):null;
  return {p,out};
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
test('prioritizes rule-check and different replies but does not rank moves',()=>{
 const same=mkCase(1,[mkBranch('A',true,'X'),mkBranch('B',false,'X')]);
 const divergent=mkCase(2,[mkBranch('A',true,'X'),mkBranch('B',false,'Y')]);
 const terminal=mkCase(3,[mkBranch('A',true,'X'),mkBranch('B',false,null)]);
 const {p,out}=run([same,divergent,terminal]);
 assert.equal(p.status,0,p.stderr);
 assert.deepEqual(out.cases.map(x=>x.inspectionTier),
  ['TERMINAL_RULE_CHECK','RESPONSE_DIVERGENCE','SAME_REFERENCE_REPLY']);
 assert.deepEqual(out.cases.map(x=>x.pair),[3,2,1]);
 assert.equal(out.cases[1].actualMove,'A');
 assert.equal(out.cases[1].alternatives[0].move,'B');
 assert.match(out.cases[1].interpretation,/not a move-quality ranking/);
});
test('rejects ambiguous played move attribution',()=>{
 const {p}=run([mkCase(1,[mkBranch('A',true,'X'),mkBranch('B',true,'Y')])]);
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/Exactly one played move/);
});
test('rejects inconsistent terminal reply logs',()=>{
 const point=mkCase(1,[mkBranch('A',true,'X'),mkBranch('B',false,null)]);
 point.branches[1].legalOpponentReplies=2;
 const {p}=run([point]);
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/Missing reply despite legal opponent moves/);
});
