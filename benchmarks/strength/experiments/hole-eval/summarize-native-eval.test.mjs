import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/experiments/hole-eval/summarize-native-eval.mjs');
function testRun(overrides={}) {
 const tmp=mkdtempSync(join(tmpdir(),'native-strength-'));
 try {
  const sf='4k4/9/9/9/9/9/9/9/4K4 b - 1';
  const c={event:'config',opponent:'baseline',budget:100,cap:20,pairs:1,fixtureSha:'fixture',
   candidateSha:'candidate-wasm',baselineSha:'baseline-wasm'};
  const trial=(kind,side,move,winner)=>({event:'game',pair:21,kind,candidateSide:side,
   start:sf,holes:kind==='pit'?['5e']:['4e','5e','6e','4f','5f','6f','4g','5g','6g'],
   winner,reason:winner===null?'ply-cap':'no-legal',
   turns:[{side:0,engine:side===0?'candidate':'opponent',move,depth:5,nodes:100,
    elapsed:100,requestMs:100}]});
  const games=[
   trial('pit',0,'5i6h',0),trial('pit',1,'5i5h',0),
   trial('blackhole',0,'5i6h',null),trial('blackhole',1,'5i6h',null)
  ];
  const rows=overrides.games??games;
  const all=[c,...rows].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const src=join(tmp,'matches.jsonl'),out=join(tmp,'out.json');
  writeFileSync(src,all);
  const r=spawnSync(process.execPath,[script,out,src],{encoding:'utf8',timeout:5000,env:{...process.env,GITHUB_STEP_SUMMARY:''}});
  return {status:r.status,stderr:r.stderr,summary:r.status===0?JSON.parse(readFileSync(out,'utf8')):null};
 }finally{rmSync(tmp,{recursive:true,force:true});}
}
test('counts decisive games and leaves every capped game unresolved',()=>{
 const {status,stderr,summary}=testRun();
 assert.equal(status,0,stderr);
 assert.deepEqual(summary.total,{games:4,candidateWins:1,candidateLosses:1,
  undecided:2,openingPairs:2,firstMoveDifferences:1,firstMoveComparisons:2});
 assert.equal(summary.experiments[0].byBoard.find(x=>x.kind==='pit').wins,1);
 assert.equal(summary.experiments[0].byBoard.find(x=>x.kind==='blackhole').undecided,2);
 assert.equal(summary.experiments[0].throughput.candidate.turns,2);
 assert.equal(summary.experiments[0].throughput.baseline.turns,2);
});
test('refuses a missing swapped-side game',()=>{
 const sf='4k4/9/9/9/9/9/9/9/4K4 b - 1';
 const g={event:'game',pair:21,kind:'pit',candidateSide:0,start:sf,holes:['5e'],winner:0,reason:'no-legal',
  turns:[{side:0,engine:'candidate',move:'5i6h'}]};
 const {status,stderr}=testRun({games:[g,g,g,g]});
 assert.notEqual(status,0);
 assert.match(stderr,/Missing one candidate side|Each opening must be played/);
});
test('refuses to report capped games as decisive',()=>{
 const sf='4k4/9/9/9/9/9/9/9/4K4 b - 1';
 const g=(kind,side)=>({event:'game',pair:21,kind,candidateSide:side,start:sf,holes:kind==='pit'?['5e']:['4e'],
  winner:0,reason:'ply-cap',turns:[{side:0,engine:side===0?'candidate':'opponent',move:'5i6h'}]});
 const {status,stderr}=testRun({games:[g('pit',0),g('pit',1),g('blackhole',0),g('blackhole',1)]});
 assert.notEqual(status,0);
 assert.match(stderr,/Ply cap incorrectly adjudicated/);
});
