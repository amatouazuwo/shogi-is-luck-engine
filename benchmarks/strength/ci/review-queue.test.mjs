import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/ci/review-queue.mjs');
function run(gameRows) {
  const cwd=mkdtempSync(join(tmpdir(),'strength-review-'));
  try {
    const file=join(cwd,'games.jsonl');
    writeFileSync(file,[{event:'config',opponent:'baseline',budget:100,fixtureSha:'fixture',candidateSha:'candidate'},...gameRows].map(JSON.stringify).join('\n')+'\n');
    const proc=spawnSync(process.execPath,[script,file],{cwd,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''}});
    const output=proc.status===0?JSON.parse(readFileSync(join(cwd,'results/review-queue.json'),'utf8')):null;
    return {proc,output};
  } finally {rmSync(cwd,{recursive:true,force:true});}
}
const mk=(side,winner,turns)=>({event:'game',kind:'pit',pair:21,start:'start',holes:['3e'],candidateSide:side,winner,reason:'no-legal',turns:turns.map((move,i)=>({move,engine:i%2===side?'candidate':'opponent'}))});
test('replay entries retain both colors and divergent move without pretending a blunder',()=>{
  const {proc,output}=run([mk(0,0,['a','b','c']),mk(1,0,['a','d','e','f'])]);
  assert.equal(proc.status,0,proc.stderr);
  const x=output.entries[0];
  assert.deepEqual(x.results,{candidateSente:'win',candidateGote:'loss'});
  assert.equal(x.divergencePly,2);
  assert.deepEqual(x.divergentMoves,{candidateSente:'b',candidateGote:'d'});
  assert.equal(x.reviewCandidates[0].lastCandidateMove,'f');
  assert.equal(x.reviewCandidates[0].lastCandidatePly,4);
  assert.match(x.caveat,/not proven blunders/);
});
test('replay queue preserves exact pre-move positions and prior moves',()=>{
  const sente=mk(0,0,['a','b','c']);
  const gote=mk(1,0,['a','d','e','f']);
  sente.turns.forEach((t,i)=>{t.sfenBefore='sente-'+i;});
  gote.turns.forEach((t,i)=>{t.sfenBefore='gote-'+i;});
  const {proc,output}=run([sente,gote]);
  assert.equal(proc.status,0,proc.stderr);
  const x=output.entries[0];
  assert.deepEqual(x.divergentPositions,{candidateSente:'sente-1',candidateGote:'gote-1'});
  assert.equal(x.reviewCandidates[0].lastCandidateSfen,'gote-3');
  assert.deepEqual(x.reviewCandidates[0].precedingMoves,['a','d','e']);
});
test('identical completed sequences have no divergence',()=>{
  const {proc,output}=run([mk(0,0,['a','b']),mk(1,0,['a','b'])]);
  assert.equal(proc.status,0,proc.stderr);
  assert.equal(output.entries[0].divergencePly,null);
});
test('mismatched starts fail rather than producing comparisons',()=>{
  const b=mk(1,0,['a']);b.start='other';
  const {proc}=run([mk(0,0,['a']),b]);
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/Different starting position/);
});
