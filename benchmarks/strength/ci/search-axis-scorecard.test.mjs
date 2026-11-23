import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn} from './clock-budget.mjs';
import {scoreSearchAxisGames} from './search-axis-scorecard.mjs';

function sample(axis='depth'){
  const depth=axis==='depth'?[4,2]:[64,64];
  const nodes=axis==='depth'?[250000,250000]:[10000,500];
  const config={event:'config',budget:1000,opponentBudget:1000,cap:300,
    pairs:1,opponent:'baseline',clockMs:180000,
    candidateSha:'same-wasm',baselineSha:'same-wasm',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:'fixture-20261221',
    candidateClockDivisor:20,opponentClockDivisor:20,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    candidatePolicy:'fixed',opponentPolicy:'fixed',
    candidateDepthCap:depth[0],opponentDepthCap:depth[1],
    candidateNodesCap:nodes[0],opponentNodesCap:nodes[1],
    clockDelayMethod:'virtual-debit-not-wall-wait'};
  function turn(engine){
    const candidate=engine==='candidate',index=candidate?0:1;
    const p=planTurn({remainingMs:180000,nominalMs:1000,
      divisor:20,preMoveDelayMs:1300});
    const depthObserved=axis==='depth'?depth[index]:candidate?6:2;
    const nodesObserved=axis==='depth'?(candidate?1100:200):nodes[index];
    return {engine,move:'7g7f',score:50,pv:['7g7f','3c3d'],
      depth:depthObserved,nodes:nodesObserved,
      depthCap:depth[index],nodesCap:nodes[index],
      elapsed:p.searchMs,requestMs:p.searchMs,clockDivisor:20,
      preMoveDelayChargedMs:p.preMoveDelayChargedMs,
      clockBeforeMs:p.clockBeforeMs,clockAfterDelayMs:p.clockAfterDelayMs,
      clockAfterTurnMs:p.clockAfterDelayMs-p.searchMs,
      chargedMs:p.preMoveDelayChargedMs+p.searchMs};
  }
  const games=[];
  for(const kind of ['pit','blackhole'])for(const candidateSide of [0,1])
    games.push({event:'game',pair:100,kind,candidateSide,start:'fixture-'+kind,
      holes:kind==='pit'?['5e']:['4e','5e','6e'],
      reason:'ply-cap',winner:null,
      turns:[turn('candidate'),turn('opponent')],
      clocks:candidateSide===0?[150000,149000]:[149000,150000]});
  return [config,...games];
}
test('depth2 versus depth4 only varies depth cap',()=>{
  const s=scoreSearchAxisGames(sample('depth'),'depth');
  assert.equal(s.axis,'depth');
  assert.equal(s.gameCount,4);
  assert.equal(s.neutralUndecided,4);
  assert.equal(s.strongerControl.depthCap,4);
  assert.equal(s.weakerControl.depthCap,2);
  assert.equal(s.strongerControl.meanObservedDepth,4);
  assert.equal(s.humanAmateurRankCalibrated,false);
});
test('node500 versus node10000 only varies node limit',()=>{
  const s=scoreSearchAxisGames(sample('nodes'),'nodes');
  assert.equal(s.strongerControl.nodesCap,10000);
  assert.equal(s.weakerControl.nodesCap,500);
  assert.equal(s.strongerControl.meanObservedNodes,10000);
  assert.equal(s.weakerControl.meanObservedNodes,500);
});
test('wrong cap values or independently measured exceeded caps fail',()=>{
  const a=sample('nodes');a[1].turns[0].nodes=10001;
  assert.throws(()=>scoreSearchAxisGames(a,'nodes'),/exceeded node cap/);
  const b=sample('depth');b[1].turns[0].depth=5;
  assert.throws(()=>scoreSearchAxisGames(b,'depth'),/exceeded depth cap/);
  const c=sample('nodes');c[0].opponentNodesCap=10000;
  assert.throws(()=>scoreSearchAxisGames(c,'nodes'),/Unexpected node/);
});
test('tampered single PV, evaluation or same-engine evidence fail',()=>{
  const a=sample('depth');a[1].turns[0].pv=['2g2f'];
  assert.throws(()=>scoreSearchAxisGames(a,'depth'),/PV first move/);
  const b=sample('depth');b[1].turns[0].score=null;
  assert.throws(()=>scoreSearchAxisGames(b,'depth'),/numeric search score/);
  const c=sample('nodes');c[0].baselineSha='another-engine';
  assert.throws(()=>scoreSearchAxisGames(c,'nodes'),/Model and WASM/);
});
test('a cap cannot be falsely reported as a win; both clocks must match',()=>{
  const a=sample('depth');a[1].winner=0;
  assert.throws(()=>scoreSearchAxisGames(a,'depth'),/neutral/);
  const b=sample('nodes');b[0].opponentClockDivisor=12;
  assert.throws(()=>scoreSearchAxisGames(b,'nodes'),/Expected values/);
});
