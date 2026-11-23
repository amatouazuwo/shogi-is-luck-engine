import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

// Controlled forced-check A/B: v2 otherwise identical to check3s.
// This file does not auto-update any difficulty profile or declare stronger play.
export function summarizeCheckResponseTiming(events){
  const configEvents=events.filter(x=>x?.event==='config');
  assert.equal(configEvents.length,1);
  const config=configEvents[0];
  assert.equal(config.candidatePolicy,'adaptive-feature-v2-check3s');
  assert.equal(config.opponentPolicy,'adaptive-feature-v2');
  for(const field of ['budget','opponentBudget'])
    assert.equal(config[field],6000);
  for(const field of ['candidateClockDivisor','opponentClockDivisor'])
    assert.equal(config[field],12);
  for(const field of ['candidatePreMoveDelayMs','opponentPreMoveDelayMs'])
    assert.equal(config[field],1300);
  assert.equal(config.clockMs,180000);
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:6000,expectedOpponentBudget:6000,
  });
  const games=events.filter(x=>x?.event==='game');
  const candidateTurns=games.flatMap(g=>g.turns.filter(t=>t.engine==='candidate'));
  const oldTurns=games.flatMap(g=>g.turns.filter(t=>t.engine==='opponent'));
  const mean=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length*1000)/1000:null;
  const turnsStats=(turns,side)=>({
    turns:turns.length,
    forcedCheckResponses:turns.filter(t=>t.tacticalFeatures?.inCheck===true &&
      t.tacticalFeatures.legalCount<=3).length,
    rawSixSecondDecisions:turns.filter(t=>t.policyDecision?.rawTargetMs===6000).length,
    rawThreeSecondDecisions:turns.filter(t=>t.policyDecision?.rawTargetMs===3000).length,
    meanSearchMs:mean(turns.map(t=>t.elapsed)),
    meanRequestedMs:mean(turns.map(t=>t.requestMs)),
    meanDepth:base.performance[side].meanSearchDepth,
    meanClockDebitMs:base.performance[side].meanClockChargeMs,
    totalFeatureDetectionMs:base.performance[side].featureDetectionMs,
  });
  const remaining=who=>games.map(g=>g.clocks[
    who==='candidate'?g.candidateSide:1-g.candidateSide
  ]);
  const newRemaining=remaining('candidate'),oldRemaining=remaining('opponent');
  const newStats=turnsStats(candidateTurns,'candidate'),oldStats=turnsStats(oldTurns,'opponent');
  assert.equal(newStats.rawSixSecondDecisions,0,
    'Check3s candidate must never select raw six seconds');
  return {
    event:'forced-check-three-vs-six',
    status:'exploratory-only',
    experiment:'Three seconds for at most three legal responses to check; all other v2 logic unchanged',
    openingFamilies:config.pairs,
    games:base.games,
    threeSecondPolicyWins:base.candidateWins,
    sixSecondPolicyWins:base.opponentWins,
    undecidedNeutral:base.neutralUndecided,
    threeSecondPolicy:{
      ...newStats,meanFinalClockSec:mean(newRemaining.map(v=>v/1000)),
      minimumFinalClockSec:Math.round(Math.min(...newRemaining))/1000,
    },
    originalSixSecondPolicy:{
      ...oldStats,meanFinalClockSec:mean(oldRemaining.map(v=>v/1000)),
      minimumFinalClockSec:Math.round(Math.min(...oldRemaining))/1000,
    },
    perGame:games.map(g=>({
      family:g.pair,obstacle:g.kind,experimentSide:g.candidateSide,
      winner:g.winner,reason:g.reason,plies:g.turns.length,
      experimentalClockSec:Math.round(g.clocks[g.candidateSide])/1000,
      originalClockSec:Math.round(g.clocks[1-g.candidateSide])/1000,
    })),
    source:base.source,
    productionChange:false,amateurRankVerified:false,
    caution:'Only a pilot; if no forced-check positions occurred, this does not test the targeted condition. '+
      'Even with exposures, 4 correlated games per family are not enough to certify strength. '+
      'A legal-response count cannot by itself show that 6s is necessary. '+
      'Max 300 ply neutral, browser UI delay and 1% events not evaluated.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,path]=process.argv;
  assert.ok(path,'Usage: node forced-check-timing-scorecard.mjs GAMES.jsonl');
  const events=readFileSync(resolve(path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarizeCheckResponseTiming(events)));
}
