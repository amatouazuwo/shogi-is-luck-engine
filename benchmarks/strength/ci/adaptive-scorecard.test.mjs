import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';
import {chooseAdaptiveThink} from './adaptive-think-policy.mjs';
import {summarizeAdaptiveTrial} from './adaptive-scorecard.mjs';

function mock(fixedMs=1000){
  const config={event:'config',budget:6000,opponentBudget:fixedMs,
    pairs:1,cap:300,opponent:'baseline',
    candidateSha:'same-model',baselineSha:'same-model',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:'fixture-20261206',
    candidateClockDivisor:12,opponentClockDivisor:12,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait',
    candidatePolicy:'adaptive-feature-v1'};
  const features={inCheck:false,legalCount:30,captureMoves:0,promotionMoves:0};
  const chosen=chooseAdaptiveThink(features,180000);
  const a=planTurn({remainingMs:180000,nominalMs:chosen.maxThinkMs,
    divisor:12,preMoveDelayMs:1300});
  const b=planTurn({remainingMs:180000,nominalMs:fixedMs,
    divisor:12,preMoveDelayMs:1300});
  const turn=(engine,p)=>({
    engine,elapsed:p.searchMs+1,requestMs:p.searchMs,depth:6,nodes:10000,
    clockBeforeMs:p.clockBeforeMs,clockAfterDelayMs:p.clockAfterDelayMs,
    preMoveDelayChargedMs:p.preMoveDelayChargedMs,
    clockDivisor:12,clockAfterTurnMs:p.clockAfterDelayMs-p.searchMs-1,
    chargedMs:p.preMoveDelayChargedMs+p.searchMs+1,
    clockBeforeFeatureMs:engine==='candidate'?180003:180000,
    featureDetectionMs:engine==='candidate'?3:0,
    tacticalFeatures:engine==='candidate'?features:null,
    policyDecision:engine==='candidate'?chosen:null,
  });
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1]){
    games.push({event:'game',kind,pair:200,candidateSide,
      start:kind==='pit'?'sfen1':'sfen2',
      holes:kind==='pit'?['5e']:['4e','5e','6e'],
      winner:null,reason:'ply-cap',turns:[turn('candidate',a),turn('opponent',b)],
      clocks:candidateSide===0?[60000,50000]:[50000,60000],
    });
  }
  return [config,...games];
}
test('adaptive scorecard retains all undecided outcomes and measures triggers',()=>{
  const result=summarizeAdaptiveTrial(mock(1000),{opponentBudgetMs:1000});
  assert.equal(result.games,4);
  assert.equal(result.neutralUndecided,4);
  assert.equal(result.adaptiveWins,0);
  assert.equal(result.baselineWins,0);
  assert.equal(result.cappedNeutral,4);
  assert.equal(result.decisionCounts.quiet,4);
  assert.equal(result.adaptive.meanRequestedThinkMs,1000);
  assert.equal(result.rankCalibrated,false);
});
test('another fixed opponent budget is supported',()=>{
  const result=summarizeAdaptiveTrial(mock(6000),{opponentBudgetMs:6000});
  assert.equal(result.baselineFixedMaxMs,6000);
  assert.equal(result.fixed.meanRequestedThinkMs,6000);
});
test('fabricated policy decisions, wrong model and false wins are rejected',()=>{
  const a=mock();a[1].turns[0].policyDecision.maxThinkMs=6000;
  assert.throws(()=>summarizeAdaptiveTrial(a),/Adaptive search decision/);
  const b=mock();b[0].baselineSha='other';
  assert.throws(()=>summarizeAdaptiveTrial(b),/Model and WASM/);
  const c=mock();c[2].winner=0;
  assert.throws(()=>summarizeAdaptiveTrial(c),/neutral/);
});
test('adaptive scorer verifies feature-detection costs against clock',()=>{
  const a=mock();a[2].turns[0].clockBeforeFeatureMs=180000;
  assert.throws(()=>summarizeAdaptiveTrial(a),/Tactical feature processing/);
});
