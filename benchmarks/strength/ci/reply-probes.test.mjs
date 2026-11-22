import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script = resolve('benchmarks/strength/ci/reply-probes.mjs');
const fakeReferee = `#!/usr/bin/env node
const readline=require('node:readline');
for(const stream of [readline.createInterface({input:process.stdin})]) stream.on('line',line=>{
  const [cmd, sfen, holes, move]=line.split('\\t');
  const legal=sfen==='start'?['A','B','C']:sfen.startsWith('after:')?['X','Y']:sfen.startsWith('end:')?['Z']:[];
  if(cmd==='reset') console.log(JSON.stringify({ok:true}));
  else if(cmd==='legal') console.log(JSON.stringify({moves:legal}));
  else if(cmd==='step') console.log(JSON.stringify({sfen:sfen==='start'?'after:'+move:'end:'+move}));
  else if(cmd==='go') console.log(JSON.stringify({bestmove:holes.startsWith('end:')?'Z':'X',depth:2,nodes:10,elapsed_ms:100}));
  else console.log(JSON.stringify({error:'unsupported'}));
});
`;
function run(point) {
  const cwd=mkdtempSync(join(tmpdir(),'reply-probe-test-'));
  try {
    const referee=join(cwd,'referee.cjs'), input=join(cwd,'input.json');
    writeFileSync(referee,fakeReferee);chmodSync(referee,0o755);
    writeFileSync(input,JSON.stringify({schema:1,checkpoints:[point]}));
    const proc=spawnSync(process.execPath,[script,referee,input],{cwd,encoding:'utf8',
      env:{...process.env,GITHUB_STEP_SUMMARY:''},timeout:5000});
    const output=proc.status===0?JSON.parse(readFileSync(join(cwd,'results/reply-probes.json'),'utf8')):null;
    return {proc,output};
  } finally {rmSync(cwd,{recursive:true,force:true});}
}
const point={file:'direct.jsonl',kind:'pit',pair:21,candidateSide:1,
  candidatePly:5,sfen:'start',holes:['3e'],playedMove:'B',
  legalMoves:['A','B','C'],sourceFixtureSha256:'test',budgetMs:100};
test('compares the played move and two legal alternatives without ranking them',()=>{
  const {proc,output}=run(point);
  assert.equal(proc.status,0,proc.stderr);
  const branches=output.records[0].branches;
  assert.deepEqual(branches.map(x=>x.move),['B','A','C']);
  assert.deepEqual(branches.map(x=>x.referenceReply),['X','X','X']);
  assert.deepEqual(branches.map(x=>x.afterReplySfen),['end:X','end:X','end:X']);
  assert.deepEqual(branches.map(x=>x.referenceContinuation.move),['Z','Z','Z']);
  assert.deepEqual(branches.map(x=>x.referenceContinuation.afterSfen),['end:Z','end:Z','end:Z']);
  assert.equal(branches.filter(x=>x.played).length,1);
  assert.equal(output.records[0].assessment,'UNRANKED_REPLIES_ONLY');
});
test('rejects stale or incorrect legal move sets before searching',()=>{
  const {proc}=run({...point,legalMoves:['B','C']});
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/Legality changed since checkpoint/);
});
test('rejects played moves absent from the provided legal set',()=>{
  const {proc}=run({...point,playedMove:'Z'});
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/Played move not in checkpoint legal set/);
});
