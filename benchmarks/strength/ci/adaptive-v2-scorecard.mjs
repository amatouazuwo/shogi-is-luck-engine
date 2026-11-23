import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

// Head-to-head, same NNUE/Worker, same openings and clock conditions.
// Importantly, time saved and win outcomes are independently reported.
export function summarizeAdaptiveV2Trial(events,{expectedOpponentPolicy}={}){
  const cfg=events.find(x=>x?.event==='config');
  assert.ok(cfg,'No trial configuration');
  assert.equal(cfg.candidatePolicy,'adaptive-feature-v2');
  assert.ok(['adaptive-feature-v1','fixed'].includes(cfg.opponentPolicy));
  if(expectedOpponentPolicy!==undefined)
    assert.equal(cfg.opponentPolicy,expectedOpponentPolicy);
  assert.equal(cfg.budget,6000);
  assert.equal(cfg.opponentBudget,cfg.opponentPolicy==='fixed'?1000:6000);
  assert.equal(cfg.candidateClockDivisor,12);
  assert.equal(cfg.opponentClockDivisor,12);
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:6000,expectedOpponentBudget:cfg.opponentBudget,
  });
  const games=events.filter(x=>x?.event==='game');
  const all=who=>games.flatMap(g=>g.turns.filter(t=>t.engine===who));
  const candidateTurns=all('candidate'), opponentTurns=all('opponent');
  assert.ok(candidateTurns.length>0 && opponentTurns.length>0);
  const avg=xs=>xs.length?Math.round(xs.reduce((sum,n)=>sum+n,0)/xs.length*1000)/1000:null;
  function stats(who){
    const candidate=who==='candidate';
    const turns=candidate?candidateTurns:opponentTurns;
    const perf=base.performance[who];
    const clocks=games.map(g=>g.clocks[candidate?g.candidateSide:1-g.candidateSide]);
    const atCap=games.filter(g=>g.reason==='ply-cap')
      .map(g=>g.clocks[candidate?g.candidateSide:1-g.candidateSide]);
    const decisions=turns.filter(t=>t.policyDecision).map(t=>t.policyDecision);
    const triggers={};
    for(const d of decisions)triggers[d.reason]=(triggers[d.reason]||0)+1;
    return {
      moves:turns.length,
      avgRequestedThinkMs:avg(turns.map(t=>t.requestMs)),
      avgSearchElapsedMs:perf.meanElapsedMs,
      avgDepth:perf.meanSearchDepth,
      avgNodes:perf.meanNodes,
      meanClockDebitMs:perf.meanClockChargeMs,
      meanFinalClockSeconds:avg(clocks.map(v=>v/1000)),
      minimumFinalClockSeconds:Math.round(Math.min(...clocks))/1000,
      meanAt300PlyCapSeconds:avg(atCap.map(v=>v/1000)),
      gamesBelowOneSecond:clocks.filter(v=>v<1000).length,
      trackedAdaptiveDecisions:decisions.length,
      oneSecondRawChoices:decisions.filter(d=>d.rawTargetMs===1000).length,
      oneSecondRawShare:decisions.length?
        Math.round(decisions.filter(d=>d.rawTargetMs===1000).length/decisions.length*10000)/10000:null,
      reasons:triggers,
    };
  }
  const v2=stats('candidate'),baseline=stats('opponent');
  return {
    event:'adaptive-v2-head-to-head',
    status:'exploratory-not-calibrated',
    opponent:cfg.opponentPolicy,
    games:base.games,pairedOpeningSets:base.pairedOpeningSets,
    v2Wins:base.candidateWins,baselineWins:base.opponentWins,
    neutralUndecided:base.neutralUndecided,
    conservativeV2:v2,baseline,
    outcomeDetails:games.map(g=>({
      kind:g.kind,pair:g.pair,candidateSide:g.candidateSide,
      reason:g.reason,winner:g.winner,plies:g.turns.length,
      v2RemainingSeconds:Math.round(g.clocks[g.candidateSide])/1000,
      baselineRemainingSeconds:Math.round(g.clocks[1-g.candidateSide])/1000,
    })),
    source:base.source,
    noProductionChange:true,amateurRankValidation:'NOT_PERFORMED',
    warning:'Four paired games are NOT enough to claim v2 is stronger than v1 or fixed 1s. '+
      'Both models use same NNUE+Worker; game clock charges feature detection; '+
      '300-ply/repetition remains neutral. No Elo or amateur grade certification.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,filename,policy]=process.argv;
  assert.ok(filename,'Usage: node adaptive-v2-scorecard.mjs games.jsonl [adaptive-feature-v1|fixed]');
  const x=readFileSync(resolve(filename),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarizeAdaptiveV2Trial(x,{expectedOpponentPolicy:policy})));
}
