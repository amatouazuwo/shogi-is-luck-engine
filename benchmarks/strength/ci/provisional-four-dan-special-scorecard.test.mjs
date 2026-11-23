import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planTurn} from './clock-budget.mjs';
import {auditProvisionalFourDanSpecial} from './provisional-four-dan-special-scorecard.mjs';

function fixture(opponentNodes=10000){
  const sources=[], stages=['opening','middle','reduced','opening','middle','reduced'];
  for(let i=0;i<6;i++)for(const kind of ['pit','blackhole'])sources.push({
    event:'opening',pair:21+i,kind,stage:stages[i],
    sfen:'synthetic-'+(21+i)+'-'+kind,
    holes:kind==='pit'?['5e']:['4d','5e','6f'],legal:12});
  const text=sources.map(JSON.stringify).join('\n')+'\n';
  const config={event:'config',opponent:'baseline',
    candidateSha:'same-wasm',baselineSha:'same-wasm',
    candidateWorkerSha:'same-worker',baselineWorkerSha:'same-worker',
    fixtureSha:createHash('sha256').update(text).digest('hex'),
    budget:1000,opponentBudget:1000,pairs:6,offset:0,cap:300,clockMs:180000,
    candidatePolicy:'fixed',opponentPolicy:'fixed',
    candidateClockDivisor:20,opponentClockDivisor:20,
    candidatePreMoveDelayMs:1300,opponentPreMoveDelayMs:1300,
    clockDelayMethod:'virtual-debit-not-wall-wait',
    candidateDepthCap:64,opponentDepthCap:64,
    candidateNodesCap:25000,opponentNodesCap:opponentNodes};
  const plan=planTurn({remainingMs:180000,nominalMs:1000,divisor:20,preMoveDelayMs:1300});
  function turn(engine){
    const candidate=engine==='candidate',limit=candidate?25000:opponentNodes;
    return {engine,move:'7g7f',score:42,pv:['7g7f'],depth:6,
      nodes:limit,depthCap:64,nodesCap:limit,
      elapsed:plan.searchMs,requestMs:plan.searchMs,clockDivisor:20,
      clockBeforeMs:plan.clockBeforeMs,preMoveDelayChargedMs:plan.preMoveDelayChargedMs,
      clockAfterDelayMs:plan.clockAfterDelayMs,
      clockAfterTurnMs:plan.clockAfterDelayMs-plan.searchMs,
      chargedMs:plan.searchMs+plan.preMoveDelayChargedMs};
  }
  const games=[];
  for(const f of sources)for(const candidateSide of [0,1]){
    const isCandidateWin=f.pair===21&&f.kind==='pit'&&candidateSide===0;
    const isOpponentWin=f.pair===24&&f.kind==='blackhole'&&candidateSide===1;
    games.push({event:'game',pair:f.pair,kind:f.kind,candidateSide,
      start:f.sfen,holes:f.holes,
      winner:isCandidateWin?candidateSide:isOpponentWin?1-candidateSide:null,
      reason:isCandidateWin||isOpponentWin?'no-legal':'ply-cap',
      turns:[turn('candidate'),turn('opponent')],clocks:[166000,166000]});
  }
  return {events:[config,...games],text};
}

test('paired 25k obstacle experiments audit all stages and leave unresolved neutral',()=>{
  const {events,text}=fixture(10000);
  const a=auditProvisionalFourDanSpecial(events,text,10000);
  assert.equal(a.candidateWins,1);
  assert.equal(a.opponentWins,1);
  assert.equal(a.neutralUndecided,22);
  assert.equal(a.fourDanCertified,false);
  assert.equal(a.sameWasmAndWorker,true);
  assert.equal(a.gameDifficultyChanged,false);
  for(const x of ['opening','middle','reduced'])assert.equal(a.stages[x].games,8);
});
test('reference tier 50k is separately audited',()=>{
  const {events,text}=fixture(50000);
  const a=auditProvisionalFourDanSpecial(events,text,50000);
  assert.equal(a.comparison.opponentNodes,50000);
});
test('modified fixture, missing color reversal and altered node cap are rejected',()=>{
  let x=fixture();
  assert.throws(()=>auditProvisionalFourDanSpecial(x.events,x.text+' ',10000),/fingerprint/);
  x=fixture();x.events.pop();
  assert.throws(()=>auditProvisionalFourDanSpecial(x.events,x.text,10000),/24|colors|calibration requires/);
  x=fixture();x.events[1].turns[0].nodes=25001;
  assert.throws(()=>auditProvisionalFourDanSpecial(x.events,x.text,10000),/node count/);
  x=fixture();x.events[0].opponentNodesCap=50000;
  assert.throws(()=>auditProvisionalFourDanSpecial(x.events,x.text,10000),/reference node/);
});
test('scoreboard does not promote a neutral result into a win',()=>{
  const x=fixture();x.events[1].winner=0;
  assert.throws(()=>auditProvisionalFourDanSpecial(x.events,x.text,10000),/neutral/);
});
