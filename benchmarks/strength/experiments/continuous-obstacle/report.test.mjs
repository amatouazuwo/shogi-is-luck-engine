import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const script=resolve('benchmarks/strength/experiments/continuous-obstacle/report.mjs');
function run(args={}){
 const root=mkdtempSync(join(tmpdir(),'rsshogi-continuous-report-'));
 try{
  const input=join(root,'log.jsonl'),out=join(root,'summary.json');
  const config={event:'config',opponent:'baseline',budget:100,cap:2,pairs:1,
   candidateSha:'same-wasm',baselineSha:args.baselineSha??'same-wasm',
   candidateWorkerSha:'continuous',baselineWorkerSha:'sliced'};
  const sfen='4k4/9/9/9/9/9/9/9/4K4 b - 1';
  const mk=(pair,kind,candidateSide,winner,reason,move)=>({event:'game',pair,kind,
   candidateSide,start:sfen,holes:kind==='pit'?['5e']:['4e','5e','6e','4f','5f','6f','4g','5g','6g'],
   winner,reason,turns:[{side:0,engine:candidateSide===0?'candidate':'opponent',
    sfenBefore:sfen,move,depth:5,nodes:100,elapsed:102,requestMs:100}]});
  const games=args.games??[
   mk(30,'pit',0,0,'no-legal','5i6h'),mk(30,'pit',1,0,'no-legal','5i5h'),
   mk(30,'blackhole',0,null,'repetition-unadjudicated','5i6h'),
   mk(30,'blackhole',1,null,'ply-cap','5i6h')
  ];
  writeFileSync(input,[config,...games].map(JSON.stringify).join('\n')+'\n');
  const r=spawnSync(process.execPath,[script,out,input],{encoding:'utf8',timeout:5000});
  return {code:r.status,stderr:r.stderr,summary:r.status===0?JSON.parse(readFileSync(out,'utf8')):null};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('valid same-WASM paired game report retains neutral unfinished outcomes',()=>{
 const x=run();
 assert.equal(x.code,0,x.stderr);
 assert.equal(x.summary.total.games,4);
 assert.equal(x.summary.total.wins,1);
 assert.equal(x.summary.total.losses,1);
 assert.equal(x.summary.total.undecided,2);
 assert.equal(x.summary.total.completeColorPairs,1);
 assert.equal(x.summary.total.incompleteColorPairs,1);
 assert.equal(x.summary.total.changedRootMoves,1);
 assert.equal(x.summary.groups[0].undecidedReasons['repetition-unadjudicated'],1);
 assert.equal(x.summary.groups[0].undecidedReasons['ply-cap'],1);
 assert.equal(x.summary.groups[0].candidateSearch.meanDepth,5);
 assert.equal(x.summary.groups[0].candidateSearch.budgetOverrun50,0);
});
test('rejects mismatched engine binaries instead of attributing model changes to search schedule',()=>{
 const x=run({baselineSha:'different-wasm'});
 assert.notEqual(x.code,0);
 assert.match(x.stderr,/WASM mismatch/);
});
