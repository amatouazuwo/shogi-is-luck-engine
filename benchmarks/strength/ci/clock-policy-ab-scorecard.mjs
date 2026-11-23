import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDifficultyGames } from './difficulty-scorecard.mjs';

// Trial compares 6000ms rsshogi against itself. Only the clock divisor differs.
// It cannot assign amateur ranks, Elo, or recommend changing live CPU options.
export function summarizeClockPolicyAB(events, { candidateDivisor } = {}) {
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:6000,expectedOpponentBudget:6000,
  });
  const cfg=events.find(x=>x?.event==='config');
  assert.equal(cfg.clockDelayMethod,'virtual-debit-not-wall-wait');
  assert.equal(cfg.opponentClockDivisor,12,'Baseline is the live maximum clock policy');
  assert.ok([24,36].includes(cfg.candidateClockDivisor));
  if(candidateDivisor!==undefined)assert.equal(cfg.candidateClockDivisor,candidateDivisor);
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  assert.ok(cfg.pairs>=1,'Need paired openings');
  const games=events.filter(x=>x?.event==='game');
  function perSide(candidate) {
    const clocks=games.map(x=>x.clocks[candidate?x.candidateSide:1-x.candidateSide]);
    const capped=games.filter(x=>x.reason==='ply-cap');
    const cappedRemaining=capped.map(x=>x.clocks[candidate?x.candidateSide:1-x.candidateSide]);
    const searches=games.flatMap(x=>x.turns.filter(t=>t.engine===(candidate?'candidate':'opponent')));
    const requested=searches.map(x=>x.requestMs);
    return {
      meanFinalClockSeconds:round(clocks.reduce((a,b)=>a+b,0)/clocks.length/1000),
      minimumFinalClockSeconds:round(Math.min(...clocks)/1000),
      meanAtPlyCapSeconds:capped.length?
        round(cappedRemaining.reduce((a,b)=>a+b,0)/capped.length/1000):null,
      underOneSecondAtEnd:clocks.filter(ms=>ms<1000).length,
      meanRequestedSearchMs:round(requested.reduce((a,b)=>a+b,0)/requested.length),
      meanNativeDepth:base.performance[candidate?'candidate':'opponent'].meanSearchDepth,
      meanClockChargeMs:base.performance[candidate?'candidate':'opponent'].meanClockChargeMs,
    };
  }
  function round(v){return Math.round(v*1000)/1000;}
  const outcomes=games.map(x=>({
    openingPair:x.pair,kind:x.kind,experimentalSide:x.candidateSide,
    winner:x.winner,reason:x.reason,plies:x.turns.length,
    experimentalRemainingSeconds:round(x.clocks[x.candidateSide]/1000),
    baselineRemainingSeconds:round(x.clocks[1-x.candidateSide]/1000),
  }));
  return {
    event:'maximum-clock-policy-ab',
    status:'sample-only',
    experimental:{maxThinkMs:6000,clockDivisor:cfg.candidateClockDivisor,
      preMoveDelayMs:cfg.candidatePreMoveDelayMs, ...perSide(true)},
    existingMaximum:{maxThinkMs:6000,clockDivisor:12,
      preMoveDelayMs:cfg.opponentPreMoveDelayMs,...perSide(false)},
    games:base.games,openingPairs:base.pairedOpeningSets,
    experimentalWins:base.candidateWins,existingWins:base.opponentWins,
    neutralUndecided:base.neutralUndecided,
    outcomes,
    source:base.source,
    sameNativeModelAndWorker:true,
    noAutomaticGameChange:true,
    amateurRankVerified:false,
    warning:'4 correlated games are preliminary. Capped and repeated games remain UNDECIDED, not draws. '+ 
      'Node Worker with simulated pre-move delay excludes UI render cost, device thermal throttling, and 1% events. '+ 
      'Do NOT assign an amateur grade or automatically update production.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,input, divisor]=process.argv;
  assert.ok(input,'Usage: node clock-policy-ab-scorecard.mjs results.jsonl [24|36]');
  const events=readFileSync(resolve(input),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarizeClockPolicyAB(events,{
    candidateDivisor:divisor===undefined?undefined:Number(divisor),
  })));
}
