import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planTurn} from './clock-budget.mjs';
import {summarizeSearchAxisAcrossStages} from './search-axis-stage-scorecard.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const idStages=['opening','middle','reduced','opening','middle','reduced'];
function sample(axis='depth'){
  const depth=axis==='depth'?[4,2]:[64,64];
  const nodes=axis==='depth'?[250000,250000]:[10000,500];
  const sources=[];
  for(let i=0;i<6;i++){
    const pair=21+i,stage=idStages[i];
    for(const kind of ['pit','blackhole']){
      sources.push({event:'opening',pair,kind,stage,
        sfen:'synthetic-sfen-'+pair+'-'+kind,
        holes:kind==='pit'?['5e']:['4e','5e','6e'],
        legal:15});
    }
  }
  const fixtures=sources.map(JSON.stringify).join('\n')+'\n';
  const config={event:'config',budget:1000,opponentBudget:1000,pairs:6,offset:0,
    cap:300,opponent:'baseline',clockMs:180000,
    candidateSha:'one-model',baselineSha:'one-model',
    candidateWorkerSha:'one-worker',baselineWorkerSha:'one-worker',
    fixtureSha:digest(fixtures),
    candidateDepthCap:depth[0],opponentDepthCap:depth[1],
    candidateNodesCap:nodes[0],opponentNodesCap:nodes[1],
    candidatePolicy:'fixed',opponentPolicy:'fixed',
    candidateClockDivisor:20,opponentClockDivisor:20,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait'};
  function turn(who){
    const high=who==='candidate',i=high?0:1;
    const plan=planTurn({remainingMs:180000,nominalMs:1000,divisor:20,
      preMoveDelayMs:1300});
    return {engine:who,move:'7g7f',score:30,pv:['7g7f','3c3d'],
      depth:axis==='depth'?depth[i]:(high?6:2),
      nodes:axis==='depth'?(high?1200:190):nodes[i],
      depthCap:depth[i],nodesCap:nodes[i],
      elapsed:plan.searchMs,requestMs:plan.searchMs,clockDivisor:20,
      clockBeforeMs:plan.clockBeforeMs,
      preMoveDelayChargedMs:plan.preMoveDelayChargedMs,
      clockAfterDelayMs:plan.clockAfterDelayMs,
      clockAfterTurnMs:plan.clockAfterDelayMs-plan.searchMs,
      chargedMs:plan.searchMs+plan.preMoveDelayChargedMs};
  }
  const games=[];
  for(const f of sources)for(const candidateSide of [0,1]){
    let winner=null,reason='ply-cap';
    if(f.pair===21&&f.kind==='pit'&&candidateSide===0){
      winner=0;reason='no-legal';
    }else if(f.pair===25&&f.kind==='blackhole'&&candidateSide===1){
      winner=0;reason='no-legal';
    }
    games.push({event:'game',pair:f.pair,kind:f.kind,
      candidateSide,start:f.sfen,holes:f.holes,winner,reason,
      turns:[turn('candidate'),turn('opponent')],
      clocks:candidateSide===0?[160000,154000]:[154000,160000]});
  }
  return {events:[config,...games],fixtures};
}
test('24 paired games spread evenly across three stages and six families',()=>{
  const {events,fixtures}=sample();
  const s=summarizeSearchAxisAcrossStages(events,fixtures,'depth');
  assert.equal(s.games,24);
  assert.equal(s.sourceFamilyCount,6);
  assert.equal(s.distinctStartingBoards,12);
  assert.equal(s.highLimitWins,1);
  assert.equal(s.lowLimitWins,1);
  assert.equal(s.neutralUndecided,22);
  for(const stage of ['opening','middle','reduced']){
    assert.equal(s.stages[stage].games,8);
    assert.equal(s.stages[stage].sourceFamilies.length,2);
    assert.equal(s.stages[stage].byObstacle.pit.games,4);
    assert.equal(s.stages[stage].byObstacle.blackhole.games,4);
  }
  assert.deepEqual(s.stages.opening.sourceFamilies,[21,24]);
  assert.deepEqual(s.stages.middle.sourceFamilies,[22,25]);
  assert.deepEqual(s.stages.reduced.sourceFamilies,[23,26]);
});
test('node comparison gets same audited stage distribution',()=>{
  const {events,fixtures}=sample('nodes');
  const s=summarizeSearchAxisAcrossStages(events,fixtures,'nodes');
  assert.equal(s.games,24);
  assert.equal(s.highLimit.meanNodes,10000);
  assert.equal(s.lowLimit.meanNodes,500);
  assert.equal(s.gameDifficultyChanged,false);
  assert.equal(s.amateurRankValidated,false);
});
test('tampered fixture hash or per-game starting board is rejected',()=>{
  const {events,fixtures}=sample();
  assert.throws(()=>summarizeSearchAxisAcrossStages(events,fixtures+' ','depth'),
    /fixture hash/);
  const a=sample();a.events[1].start='other-sfen';
  assert.throws(()=>summarizeSearchAxisAcrossStages(a.events,a.fixtures,'depth'),
    /Opening SFEN/);
  const b=sample();b.events[1].holes=['7e'];
  assert.throws(()=>summarizeSearchAxisAcrossStages(b.events,b.fixtures,'depth'),
    /Obstacle mask/);
});
test('inconsistent stages inside the same family fail even when hash is replaced',()=>{
  const a=sample();const rows=a.fixtures.trim().split('\n').map(JSON.parse);
  rows[1].stage='reduced';
  const rewritten=rows.map(JSON.stringify).join('\n')+'\n';
  a.events[0].fixtureSha=digest(rewritten);
  assert.throws(()=>summarizeSearchAxisAcrossStages(a.events,rewritten,'depth'),
    /share a stage/);
});
test('missing color-swapped game and fake 300ply winners are rejected',()=>{
  const a=sample();a.events.pop();
  assert.throws(()=>summarizeSearchAxisAcrossStages(a.events,a.fixtures,'depth'),
    /Obstacle calibration requires/);
  const b=sample();b.events[2].winner=1;
  assert.throws(()=>summarizeSearchAxisAcrossStages(b.events,b.fixtures,'depth'),
    /neutral/);
});
test('wrong actual nodes and altered clock budget cannot pass',()=>{
  const a=sample('nodes');a.events[1].turns[0].nodes=10001;
  assert.throws(()=>summarizeSearchAxisAcrossStages(a.events,a.fixtures,'nodes'),
    /exceeded node cap/);
  const b=sample();b.events[1].turns[0].requestMs=250;
  assert.throws(()=>summarizeSearchAxisAcrossStages(b.events,b.fixtures,'depth'),
    /Observed Worker budget/);
});
