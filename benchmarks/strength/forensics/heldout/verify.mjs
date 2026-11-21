import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({options:{
  solver:{type:'string',default:'./solve'},
  corpus:{type:'string',multiple:true},
}});
assert.ok(args.corpus?.length,'Pass --corpus PATH for one or more frozen JSONL files');
const positions=[];
const digests={};
for(const file of args.corpus){
  const bytes=readFileSync(file);
  digests[file]=createHash('sha256').update(bytes).digest('hex');
  positions.push(...bytes.toString('utf8').trim().split('\n').map(JSON.parse));
}
const ids=new Set();
const inputs=positions.map(p=>{
  assert.ok(!ids.has(p.id),p.id);
  ids.add(p.id);
  assert.ok(['attack','escape'].includes(p.proof.kind),p.id);
  assert.ok([3,5,7].includes(p.horizon),p.id);
  return [p.proof.kind,p.sfen,p.holes.join(','),p.horizon].join('\t');
});
const output=execFileSync(args.solver,[],{input:inputs.join('\n')+'\n',encoding:'utf8',maxBuffer:8*1024*1024});
const answers=output.trim().split('\n').map(JSON.parse);
assert.equal(answers.length,positions.length);
const tallies={};
let nodes=0;
for(let i=0;i<positions.length;i++){
  const p=positions[i], answer=answers[i];
  assert.equal(answer.status,'ok',p.id);
  assert.equal(answer.kind,p.proof.kind,p.id);
  assert.equal(answer.depth,p.horizon,p.id);
  assert.deepEqual(answer.goodMoves.sort(),p.goodMoves,p.id);
  assert.deepEqual(answer.available.sort(),p.available,p.id);
  assert.deepEqual(answer.nodesByHorizon,p.proof.nodesByHorizon,p.id);
  assert.deepEqual(answer.lossPliesAfterDefense,p.proof.lossPliesAfterDefense,p.id);
  const key=[p.kind,p.proof.kind,p.horizon].join('/');
  tallies[key]=(tallies[key]||0)+1;
  nodes+=answer.nodes;
}
console.log(JSON.stringify({positions:positions.length,tallies,digests,independentNodes:nodes},null,2));
