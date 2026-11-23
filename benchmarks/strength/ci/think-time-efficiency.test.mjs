import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';
import {summarizeThinkTimeEfficiency} from './think-time-efficiency.mjs';

function fixtures(shortMs=1000){
  const cfg={event:'config',budget:shortMs,opponentBudget:6000,cap:100,pairs:1,
    opponent:'baseline',candidateSha:'sameWasm',baselineSha:'sameWasm',
    candidateWorkerSha:'sameWorker',baselineWorkerSha:'sameWorker',
    fixtureSha:'sameSeed',candidateClockDivisor:12,opponentClockDivisor:12,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait'};
  const turns=()=>['candidate','opponent'].map(engine=>{
    const c=engine==='candidate';
    const p=planTurn({remainingMs:180000,nominalMs:c?shortMs:6000,
      divisor:12,preMoveDelayMs:1300});
    const elapsed=p.searchMs+1;
    return {engine,side:c?0:1,requestMs:p.searchMs,
      elapsed,depth:c?6:7,nodes:1000,
      preMoveDelayChargedMs:p.preMoveDelayChargedMs,
      clockDivisor:12,
      clockBeforeMs:p.clockBeforeMs,
      clockAfterDelayMs:p.clockAfterDelayMs,
      clockAfterTurnMs:p.clockAfterDelayMs-elapsed,
      chargedMs:p.preMoveDelayChargedMs+elapsed};
  });
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1]){
    games.push({event:'game',pair:80,kind,candidateSide,
      winner:kind==='pit'?candidateSide:null,
      reason:kind==='pit'?'no-legal':'ply-cap',
      start:kind==='pit'?'board1':'board2',
      holes:kind==='pit'?['5e']:['4d','4e','5d'],
      clocks:candidateSide===0?[174000,170000]:[170000,174000],
      turns:turns()});
  }
  return [cfg,...games];
}
test('1 second versus 6 seconds keeps neutral outcomes separate',()=>{
  const r=summarizeThinkTimeEfficiency(fixtures(1000),{expectedCandidateMs:1000});
  assert.equal(r.shortWins,2);
  assert.equal(r.longWins,0);
  assert.equal(r.undecidedNeutral,2);
  assert.deepEqual(r.shortScoreBounds,[.5,1]);
  assert.equal(r.shortBudgetMs,1000);
  assert.equal(r.long.meanRequestedMs,6000);
  assert.equal(r.short.meanRequestedMs,1000);
  assert.equal(r.short.averageFinalClockSeconds,174);
  assert.equal(r.long.averageFinalClockSeconds,170);
  assert.equal(r.depthGainFromLongThink,1);
  assert.equal(r.clockSavedByShortAtEndSeconds,4);
  assert.equal(r.rankCalibrated,false);
  assert.equal(r.autoChangeCpuSettings,false);
});
test('3 second intermediate tier is supported',()=>{
  const r=summarizeThinkTimeEfficiency(fixtures(3000));
  assert.equal(r.shortBudgetMs,3000);
  assert.equal(r.short.meanRequestedMs,3000);
});
test('different clock fractions are rejected so cap is only variable',()=>{
  const x=fixtures();x[0].candidateClockDivisor=20;
  assert.throws(()=>summarizeThinkTimeEfficiency(x),/identical/);
});
test('mismatched model and invented decisive capped game are rejected',()=>{
  const a=fixtures();a[0].baselineSha='mismatched';
  assert.throws(()=>summarizeThinkTimeEfficiency(a),/WASM must match/);
  const b=fixtures();b[3].winner=0;
  assert.throws(()=>summarizeThinkTimeEfficiency(b),/neutral/);
});
test('invalid speculative user-facing grade is not generated',()=>{
  const r=summarizeThinkTimeEfficiency(fixtures());
  assert.equal(Object.hasOwn(r,'estimatedAmateurGrade'),false);
});
