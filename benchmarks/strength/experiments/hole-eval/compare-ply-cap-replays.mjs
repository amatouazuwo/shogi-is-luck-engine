import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

// A 300-ply test is a REPLAY from the same opening, not a resume from the
// earlier 160-ply game. Only label "continuation" if *every previous move*
// is reproduced in the longer run. Otherwise, simply compare observations.
const [oldPath,newPath,outPath='results/compare-ply-cap-replays.json']=process.argv.slice(2);
assert.ok(oldPath&&newPath,'Usage: node compare-ply-cap-replays.mjs OLD.jsonl NEW.jsonl [OUT.json]');
const readLog=path=>{
 const records=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);
 const configs=records.filter(x=>x.event==='config');
 assert.equal(configs.length,1,'Exactly one config expected '+path);
 const games=records.filter(x=>x.event==='game');
 assert.equal(games.length,configs[0].pairs*4,'Incomplete games '+path);
 const key=x=>[x.pair,x.kind,x.candidateSide].join('/');
 const seen=new Map();
 for(const x of games){
  const k=key(x);
  assert.ok(!seen.has(k),'Duplicate game '+k);
  assert.ok(x.winner===null||x.winner===0||x.winner===1);
  assert.ok(Array.isArray(x.turns));
  seen.set(k,x);
 }
 return {config:configs[0],games:seen};
};
const old=readLog(oldPath),extended=readLog(newPath);
assert.equal(old.config.budget,extended.config.budget,'Budget mismatch');
assert.equal(old.config.fixtureSha,extended.config.fixtureSha,'Opening corpus differs');
assert.ok(old.config.cap<extended.config.cap,'Expected strictly larger move cap');
assert.equal(old.games.size,extended.games.size,'Different number of games');
const pairs=[],totals={oldDecided:0,oldUndecided:0,newDecided:0,newUndecided:0,
 oldUndecidedToNewDecided:0,oldDecidedToNewUndecided:0,
 exactFullOldTrace:0,strictContinuations:0,strictContinuationAndNewDecided:0,
 divergedBeforeOldEnd:0};
const boardTotals={pit:{games:0,oldUndecided:0,newUndecided:0},
 blackhole:{games:0,oldUndecided:0,newUndecided:0}};
for(const [key,a] of old.games){
 const b=extended.games.get(key);
 assert.ok(b,'Extended test missing '+key);
 assert.equal(a.start,b.start,'Starting position changed for '+key);
 assert.deepEqual(a.holes,b.holes,'Obstacles changed for '+key);
 const ol=a.turns,nl=b.turns;
 let matchingPlies=0;
 for(;matchingPlies<Math.min(ol.length,nl.length);matchingPlies++){
  const x=ol[matchingPlies],y=nl[matchingPlies];
  if(x.sfenBefore!==y.sfenBefore||x.move!==y.move||x.side!==y.side)break;
 }
 const exactFullOldTrace=matchingPlies===ol.length&&nl.length>=ol.length;
 const strictContinuation=exactFullOldTrace&&nl.length>ol.length;
 const oldDecided=a.winner!==null,newDecided=b.winner!==null;
 const board=boardTotals[a.kind];
 assert.ok(board,'Unknown board kind');
 board.games++;
 if(!oldDecided){totals.oldUndecided++;board.oldUndecided++;}
 else totals.oldDecided++;
 if(!newDecided){totals.newUndecided++;board.newUndecided++;}
 else totals.newDecided++;
 if(!oldDecided&&newDecided)totals.oldUndecidedToNewDecided++;
 if(oldDecided&&!newDecided)totals.oldDecidedToNewUndecided++;
 if(exactFullOldTrace)totals.exactFullOldTrace++;
 if(strictContinuation){
  totals.strictContinuations++;
  if(newDecided)totals.strictContinuationAndNewDecided++;
 }
 if(!exactFullOldTrace)totals.divergedBeforeOldEnd++;
 pairs.push({key,kind:a.kind,pair:a.pair,candidateSide:a.candidateSide,
  oldPlies:ol.length,newPlies:nl.length,
  oldReason:a.reason,newReason:b.reason,
  oldResult:oldDecided?(a.winner===a.candidateSide?'WIN':'LOSS'):'UNDECIDED',
  newResult:newDecided?(b.winner===b.candidateSide?'WIN':'LOSS'):'UNDECIDED',
  matchingPlies,exactFullOldTrace,strictContinuation,
  meaningfulStatus:'No move-quality label inferred from replay length or an undecided outcome'});
}
pairs.sort((a,b)=>a.key.localeCompare(b.key));
const report={schema:1,oldPath,newPath,oldCap:old.config.cap,newCap:extended.config.cap,
 thinkBudgetMs:old.config.budget,oldCandidateWasm:old.config.candidateSha,newCandidateWasm:extended.config.candidateSha,
 oldBaselineWasm:old.config.baselineSha,newBaselineWasm:extended.config.baselineSha,
 equalBinaryHashes:old.config.candidateSha===extended.config.candidateSha&&old.config.baselineSha===extended.config.baselineSha,
 totals,byBoard:boardTotals,cases:pairs,
 note:'A new 300-ply run is a fresh match from the opening, not an actual resumed 160-ply game. A newly decided replay is NOT necessarily a continuation. Even exact prefix equality does not prove changed strategic ability. Undecided is neutral and must never be penalized.'};
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({oldCap:report.oldCap,newCap:report.newCap,totals,byBoard:boardTotals},null,2));
