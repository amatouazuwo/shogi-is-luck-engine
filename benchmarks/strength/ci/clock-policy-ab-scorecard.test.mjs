import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';
import {summarizeClockPolicyAB} from './clock-policy-ab-scorecard.mjs';

function sample(divisor=24){
  const config={event:'config',budget:6000,opponentBudget:6000,
    cap:100,pairs:1,opponent:'baseline',
    candidateSha:'same-wasm',baselineSha:'same-wasm',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:'fixture-20261130',clockDelayMethod:'virtual-debit-not-wall-wait',
    candidateClockDivisor:divisor,opponentClockDivisor:12,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300};
  const turns=()=>{
    return ['candidate','opponent'].map(engine=>{
      const candidate=engine==='candidate';
      const p=planTurn({remainingMs:180000,nominalMs:6000,
        divisor:candidate?divisor:12,preMoveDelayMs:1300});
      const elapsed=p.searchMs+1;
      return {engine,elapsed,depth:candidate?7:8,nodes:1000,
        requestMs:p.searchMs,clockDivisor:candidate?divisor:12,
        preMoveDelayChargedMs:p.preMoveDelayChargedMs,
        chargedMs:p.preMoveDelayChargedMs+elapsed,
        clockBeforeMs:p.clockBeforeMs,clockAfterDelayMs:p.clockAfterDelayMs,
        clockAfterTurnMs:p.clockAfterDelayMs-elapsed};
    });
  };
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1]){
    games.push({event:'game',pair:123,kind,candidateSide,
      start:kind==='pit'?'normal start':'different start',
      holes:kind==='pit'?['5e']:['4d','4e','5e','5d','6d','6e','4f','5f','6f'],
      winner:kind==='pit'?(candidateSide===0?0:0):null,
      reason:kind==='pit'?'no-legal':'ply-cap',
      clocks:candidateSide===0?[172000,171000]:[171000,172000],
      turns:turns()});
  }
  return [config,...games];
}
test('A/B confirms two different 6000ms policies and preserves undecided games',()=>{
  const r=summarizeClockPolicyAB(sample(24),{candidateDivisor:24});
  assert.equal(r.games,4);
  assert.equal(r.experimentalWins,1);
  assert.equal(r.existingWins,1);
  assert.equal(r.neutralUndecided,2);
  assert.equal(r.experimental.clockDivisor,24);
  assert.equal(r.existingMaximum.clockDivisor,12);
  assert.equal(r.amateurRankVerified,false);
  assert.equal(r.noAutomaticGameChange,true);
  assert.equal(r.outcomes.filter(x=>x.reason==='ply-cap').length,2);
});
test('both 24 and 36 are valid and show different search budgets',()=>{
  const conservative=summarizeClockPolicyAB(sample(24));
  const saver=summarizeClockPolicyAB(sample(36));
  assert.ok(conservative.experimental.meanRequestedSearchMs>
    saver.experimental.meanRequestedSearchMs);
  assert.equal(conservative.existingMaximum.meanRequestedSearchMs,6000);
  assert.equal(saver.existingMaximum.meanRequestedSearchMs,6000);
});
test('candidate cannot silently have the same divisor as baseline',()=>{
  const e=sample();e[0].candidateClockDivisor=12;
  assert.throws(()=>summarizeClockPolicyAB(e),/24|36/);
});
test('turn budgets are recomputed, never trusted from log',()=>{
  const e=sample();e[1].turns[0].requestMs=1200;
  assert.throws(()=>summarizeClockPolicyAB(e),/Observed Worker budget/);
});
test('missing reversed-color case or forced winner from ply-cap must fail',()=>{
  const missing=sample();missing.pop();
  assert.throws(()=>summarizeClockPolicyAB(missing),/Obstacle calibration requires/);
  const invented=sample();invented[4].winner=0;
  assert.throws(()=>summarizeClockPolicyAB(invented),/neutral/);
});
