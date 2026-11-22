import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {proveTerminal,candidateOutcome} from './terminal-proof.mjs';
import {prioritizeProofPositions} from './proof-priority.mjs';

// Prove finite terminal outcomes for at most two archived diagnostic positions.
// Every non-proven outcome is UNKNOWN. This is NOT a global claim of move quality.
const [referee,input='results/reply-probes.json']=process.argv.slice(2);
assert.ok(referee,'Usage: node prove-checkpoints.mjs REFEREE reply-probes.json');
const payload=JSON.parse(readFileSync(input,'utf8'));
assert.equal(payload.schema,1);
assert.ok(Array.isArray(payload.records));
const child=spawn(referee,[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
async function query(...args) {
  child.stdin.write(args.join('\t')+'\n');
  let timer;
  try {
    const r=await Promise.race([lines.next(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Referee timeout')),10000))]);
    assert.equal(r.done,false,'Referee terminated');
    const x=JSON.parse(r.value);
    assert.ok(!x.error,'Referee error in '+args[0]);
    return x;
  } finally {clearTimeout(timer);}
}
const legal=async(sfen,holes)=>(await query('legal',sfen,holes)).moves;
const step=async(sfen,holes,move)=>(await query('step',sfen,holes,move)).sfen;
const records=[];
try {
  for(const selected of prioritizeProofPositions(payload.records,2)) {
    const point=selected.record;
    assert.ok(Array.isArray(point.branches) && point.branches.some(x=>x.played));
    const holes=point.holes.join(',');
    const rootLegal=await legal(point.sfen,holes);
    assert.ok(point.rootLegalMoveCount===undefined || point.rootLegalMoveCount===rootLegal.length,'Recorded root legal count mismatch');
    const branches=[];
    for(const branch of point.branches.slice(0,3)) {
      assert.ok(rootLegal.includes(branch.move),'Missing move in source position');
      const next=await step(point.sfen,holes,branch.move);
      assert.equal(next,branch.afterCandidateSfen,'Replay mismatch before proof');
      const proof=await proveTerminal({sfen:next,holes,legal,step,depth:3,nodeLimit:300});
      branches.push({move:branch.move,played:branch.played,
        outcomeForCandidate:candidateOutcome(proof.outcome),
        forcedPliesAfterMove:proof.distance,visitedNodes:proof.nodes,
        completeWithoutNodeCap:proof.exhausted});
    }
    const actual=branches.find(x=>x.played);
    assert.ok(actual,'No played branch');
    const winningAlternative=branches.find(x=>!x.played && x.outcomeForCandidate==='WIN');
    const localContrast=actual.outcomeForCandidate==='LOSS'&&winningAlternative
      ? 'SHORT_HORIZON_FORCED_LOSS_VS_WIN'
      : 'NOT_PROVEN';
    records.push({boardKind:point.kind,pair:point.pair,candidateSide:point.candidateSide,
      candidatePly:point.candidatePly,sfen:point.sfen,holes:point.holes,
      sourceFixtureSha256:point.sourceFixtureSha256??null,
      rootLegalMoveCount:rootLegal.length,examinedCandidateMoveCount:branches.length,
      allCandidateMovesCovered:branches.length===rootLegal.length,
      selectionCost:{maxLegalOpponentReplies:selected.maxReplies,totalLegalOpponentReplies:selected.totalReplies},
      branches,localContrast,proofScope:'Independent referee terminal/no-legal outcomes within 3 further plies after each candidate move; repetition and special live events not adjudicated.'});
  }
}finally{child.stdin.end();child.kill();}
mkdirSync('results',{recursive:true});
const result={schema:2,maxPositions:2,selectionRule:'fewest maximum legal opponent replies then total replies',depthAfterCandidateMove:3,maxNodesPerBranch:300,
  analyzed:records.length,records,warning:'Finite-horizon exhaustive terminal checks only. UNKNOWN is not a draw. Short-horizon contrasts must be checked against full game rules, new holdout cases, and stronger search before declaring a general blunder.'};
writeFileSync('results/terminal-proofs.json',JSON.stringify(result,null,2)+'\n');
const proved=records.filter(r=>r.localContrast!=='NOT_PROVEN').length;
const allBranches=records.flatMap(r=>r.branches);
const unknown=allBranches.filter(b=>b.outcomeForCandidate==='UNKNOWN').length;
const capped=allBranches.filter(b=>!b.completeWithoutNodeCap).length;
const summary='## Bounded terminal proof checks\nInvestigated '+records.length+
  ' archived positions, '+allBranches.length+' candidate branches; '+unknown+
  ' UNKNOWN, '+capped+' node-capped; '+proved+
  ' short-horizon forced contrasts. NOT a global blunder or AI promotion claim.\n';
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
console.log(summary);
