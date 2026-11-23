import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

function makeSample() {
  const config={event:'config',budget:100,opponentBudget:500,
    cap:120,pairs:1,opponent:'baseline',
    candidateSha:'same-wasm',baselineSha:'same-wasm',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:'random-seed-fixture-20261124'};
  const rows=[];
  for(const kind of ['pit','blackhole']){
    for(const candidateSide of [0,1]){
      const decided=kind==='pit';
      const winner=decided?0:null;
      rows.push({event:'game',pair:22,kind,candidateSide,
        winner, reason:decided?'no-legal':'ply-cap',
        start:kind==='pit'?'sfen pit':'sfen blackhole',
        holes:kind==='pit'?['5e']:['4d','5d','6d'],
        clocks:[150000,153000],
        turns:[
          {engine:'candidate',elapsed:100,requestMs:100,depth:4,nodes:1234},
          {engine:'opponent',elapsed:499,requestMs:500,depth:7,nodes:8923},
        ],
      });
    }
  }
  return [config,...rows];
}
test('undecided games are neutral and produce conservative score bounds',()=>{
  const result=scoreDifficultyGames(makeSample(),{
    expectedCandidateBudget:100,expectedOpponentBudget:500});
  assert.equal(result.games,4);
  assert.equal(result.candidateWins,1);
  assert.equal(result.opponentWins,1);
  assert.equal(result.neutralUndecided,2);
  assert.deepEqual(result.scoreBoundsIncludingNeutral,[.25,.75]);
  assert.equal(result.candidateDecidedWinRate,.5);
  assert.equal(result.amateurRankValidation,'NOT_PERFORMED');
  assert.equal(result.autoAssignAmateurGrade,false);
  assert.equal(result.performance.candidate.meanElapsedMs,100);
  assert.equal(result.performance.opponent.meanSearchDepth,7);
});
test('same model and worker must be checked, not inferred',()=>{
  const a=makeSample();a[0].baselineSha='different-model';
  assert.throws(()=>scoreDifficultyGames(a),/Model and WASM must match/);
  const b=makeSample();b[0].baselineWorkerSha='other-worker';
  assert.throws(()=>scoreDifficultyGames(b),/Worker implementations must match/);
});
test('color-swapped pair requires both sides and identical openings',()=>{
  const a=makeSample();a[2].candidateSide=0;
  assert.throws(()=>scoreDifficultyGames(a),/deep-equal|Expected values/);
  const b=makeSample();b[2].start='different';
  assert.throws(()=>scoreDifficultyGames(b),/same starting SFEN/);
});
test('capped game must not have a fabricated winner',()=>{
  const a=makeSample();a[3].winner=1;
  assert.throws(()=>scoreDifficultyGames(a),/neutral/);
});
test('unexpected missing games cannot produce a PASS scorecard',()=>{
  const a=makeSample();a.pop();
  assert.throws(()=>scoreDifficultyGames(a),/requires both pit\/blackhole/);
});
test('all four official nominal budgets are accepted for future tiers',()=>{
  for(const budget of [100,500,1500,6000]){
    const a=makeSample();a[0].budget=budget;a[0].opponentBudget=budget;
    for(const g of a.slice(1))for(const t of g.turns)t.requestMs=Math.min(t.requestMs,budget);
    assert.equal(scoreDifficultyGames(a).candidateBudgetMs,budget);
  }
});

test('full-force game clock budget is independently audited for every native turn',()=>{
  const events=makeSample();
  Object.assign(events[0],{budget:6000,opponentBudget:1500,
    candidateClockDivisor:12,opponentClockDivisor:20,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait'});
  for(const game of events.slice(1)){
    game.turns=game.turns.map(t=>{
      const candidate=t.engine==='candidate';
      const requestMs=candidate?6000:1500,elapsed=candidate?6001:1502;
      return {...t,requestMs,elapsed,
        clockDivisor:candidate?12:20,
        clockBeforeMs:180000,
        preMoveDelayChargedMs:1300,clockAfterDelayMs:178700,
        chargedMs:1300+elapsed,clockAfterTurnMs:178700-elapsed};
    });
  }
  const score=scoreDifficultyGames(events);
  assert.equal(score.clockPolicy.candidate.divisor,12);
  assert.equal(score.clockPolicy.opponent.divisor,20);
  assert.equal(score.performance.candidate.meanClockChargeMs,7301);
  assert.equal(score.performance.opponent.meanClockChargeMs,2802);
  events[1].turns[0].requestMs=1500;
  assert.throws(()=>scoreDifficultyGames(events),/Observed Worker budget/);
});
