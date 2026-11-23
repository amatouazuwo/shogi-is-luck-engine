import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAdaptiveThinkV2} from './adaptive-think-policy-v2.mjs';
import {chooseAdaptiveThinkV2Check3s} from './adaptive-think-policy-v2-check3s.mjs';
import {planTurn} from './clock-budget.mjs';
import {summarizeCheckResponseTiming} from './forced-check-timing-scorecard.mjs';

function sample(){
  const features={inCheck:true,legalCount:2,captureMoves:0,promotionMoves:0};
  const cfg={
    event:'config',budget:6000,opponentBudget:6000,pairs:1,cap:300,
    opponent:'baseline',candidateSha:'identical-wasm',baselineSha:'identical-wasm',
    candidateWorkerSha:'identical-worker',baselineWorkerSha:'identical-worker',
    fixtureSha:'test-fixture',clockMs:180000,
    candidatePolicy:'adaptive-feature-v2-check3s',opponentPolicy:'adaptive-feature-v2',
    candidateClockDivisor:12,opponentClockDivisor:12,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait',
  };
  const makeTurn=engine=>{
    const candidate=engine==='candidate';
    const decision=candidate?chooseAdaptiveThinkV2Check3s(features,180000)
      :chooseAdaptiveThinkV2(features,180000);
    const plan=planTurn({remainingMs:180000,nominalMs:decision.maxThinkMs,
      divisor:12,preMoveDelayMs:1300});
    const elapsed=plan.searchMs;
    return {
      engine,requestMs:plan.searchMs,elapsed,
      depth:candidate?7:8,nodes:20000,
      tacticalFeatures:features,policyDecision:decision,
      featureDetectionMs:3,clockBeforeFeatureMs:180003,
      clockBeforeMs:plan.clockBeforeMs,
      preMoveDelayChargedMs:plan.preMoveDelayChargedMs,
      chargedMs:plan.preMoveDelayChargedMs+elapsed,
      clockAfterDelayMs:plan.clockAfterDelayMs,
      clockAfterTurnMs:plan.clockAfterDelayMs-elapsed,
      clockDivisor:12,
    };
  };
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1])
    games.push({
      event:'game',kind,pair:100,candidateSide,reason:'ply-cap',
      winner:null,start:'opening-'+kind,holes:kind==='pit'?['5e']:['4d','4e','5e'],
      turns:[makeTurn('candidate'),makeTurn('opponent')],
      clocks:candidateSide===0?[90000,70000]:[70000,90000],
    });
  return [cfg,...games];
}
test('scorecard reports 3s policy as exactly the changed rule',()=>{
  const result=summarizeCheckResponseTiming(sample());
  assert.equal(result.threeSecondPolicyWins,0);
  assert.equal(result.sixSecondPolicyWins,0);
  assert.equal(result.undecidedNeutral,4);
  assert.equal(result.threeSecondPolicy.forcedCheckResponses,4);
  assert.equal(result.originalSixSecondPolicy.forcedCheckResponses,4);
  assert.equal(result.threeSecondPolicy.rawSixSecondDecisions,0);
  assert.equal(result.originalSixSecondPolicy.rawSixSecondDecisions,4);
  assert.equal(result.threeSecondPolicy.meanRequestedMs,3000);
  assert.equal(result.originalSixSecondPolicy.meanRequestedMs,6000);
  assert.equal(result.productionChange,false);
});
test('wrong opponent policy and invented capped win must be rejected',()=>{
  const a=sample();a[0].opponentPolicy='fixed';
  assert.throws(()=>summarizeCheckResponseTiming(a),/adaptive-feature-v2/);
  const b=sample();b[1].winner=0;
  assert.throws(()=>summarizeCheckResponseTiming(b),/neutral/);
});
test('a forged search budget is rejected by the independent auditor',()=>{
  const a=sample();a[1].turns[0].requestMs=6000;
  assert.throws(()=>summarizeCheckResponseTiming(a),/Observed Worker budget/);
});
test('invalid 6-second new-policy decision cannot pass',()=>{
  const a=sample();a[1].turns[0].policyDecision.rawTargetMs=6000;
  assert.throws(()=>summarizeCheckResponseTiming(a),/Adaptive search decision/);
});
