import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';
import {chooseAdaptiveThink} from './adaptive-think-policy.mjs';
import {chooseAdaptiveThinkV2} from './adaptive-think-policy-v2.mjs';
import {summarizeAdaptiveV2Trial} from './adaptive-v2-scorecard.mjs';

function mock(opponentPolicy='adaptive-feature-v1'){
  const config={event:'config',budget:6000,
    opponentBudget:opponentPolicy==='fixed'?1000:6000,
    cap:300,pairs:1,opponent:'baseline',
    candidateSha:'same-wasm',baselineSha:'same-wasm',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:'same-fixture',
    candidateClockDivisor:12,opponentClockDivisor:12,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    candidatePolicy:'adaptive-feature-v2',opponentPolicy,
    clockDelayMethod:'virtual-debit-not-wall-wait'};
  function turn(engine){
    const candidate=engine==='candidate';
    const f={inCheck:false,legalCount:35,captureMoves:3,promotionMoves:0};
    const policy=candidate?'adaptive-feature-v2':opponentPolicy;
    const decision=policy==='adaptive-feature-v2'?chooseAdaptiveThinkV2(f,180000)
      :policy==='adaptive-feature-v1'?chooseAdaptiveThink(f,180000):null;
    const p=planTurn({remainingMs:180000,nominalMs:decision?.maxThinkMs??config.opponentBudget,
      divisor:12,preMoveDelayMs:1300});
    const elapsed=p.searchMs+1;
    return {engine,requestMs:p.searchMs,elapsed,depth:candidate?6:7,nodes:10000,
      clockBeforeFeatureMs:180004,featureDetectionMs:policy==='fixed'?0:4,
      tacticalFeatures:policy==='fixed'?null:f,
      policyDecision:decision,clockBeforeMs:p.clockBeforeMs,
      clockAfterDelayMs:p.clockAfterDelayMs,
      preMoveDelayChargedMs:p.preMoveDelayChargedMs,
      chargedMs:p.preMoveDelayChargedMs+elapsed,
      clockAfterTurnMs:p.clockAfterDelayMs-elapsed,
      clockDivisor:12};
  }
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1]){
    games.push({event:'game',pair:19,kind,candidateSide,
      start:'start '+kind,holes:kind==='pit'?['5e']:['4e','5e','6e'],
      winner:kind==='pit'?candidateSide:null,
      reason:kind==='pit'?'no-legal':'ply-cap',
      clocks:candidateSide===0?[140000,130000]:[130000,140000],
      turns:[turn('candidate'),turn('opponent')]});
  }
  return [config,...games];
}
test('v2 versus v1 shows both audited decisions and neutral outcomes',()=>{
  const x=summarizeAdaptiveV2Trial(mock());
  assert.equal(x.v2Wins,2);
  assert.equal(x.baselineWins,0);
  assert.equal(x.neutralUndecided,2);
  assert.equal(x.conservativeV2.oneSecondRawShare,1);
  assert.equal(x.baseline.oneSecondRawShare,0);
  assert.equal(x.conservativeV2.trackedAdaptiveDecisions,4);
  assert.equal(x.baseline.trackedAdaptiveDecisions,4);
  assert.equal(x.noProductionChange,true);
});
test('v2 versus fixed 1s has no opponent policy decisions',()=>{
  const x=summarizeAdaptiveV2Trial(mock('fixed'),{expectedOpponentPolicy:'fixed'});
  assert.equal(x.baseline.trackedAdaptiveDecisions,0);
  assert.equal(x.baseline.avgRequestedThinkMs,1000);
});
test('wrong v1 decision in opponent is rejected independently',()=>{
  const m=mock();m[1].turns[1].policyDecision.maxThinkMs=1500;
  assert.throws(()=>summarizeAdaptiveV2Trial(m),/Adaptive search decision/);
});
test('wrong v2 decision and unadjudicated winner are rejected',()=>{
  const m=mock();m[1].turns[0].requestMs=5000;
  assert.throws(()=>summarizeAdaptiveV2Trial(m),/Observed Worker budget/);
  const y=mock();y[3].winner=1;
  assert.throws(()=>summarizeAdaptiveV2Trial(y),/neutral/);
});
test('candidate policy metadata is mandatory',()=>{
  const m=mock();m[0].candidatePolicy='fixed';
  assert.throws(()=>summarizeAdaptiveV2Trial(m),/adaptive-feature-v2/);
});
