import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

export function summarizeAdaptiveTrial(events,{opponentBudgetMs}={}){
  const cfg=events.find(x=>x?.event==='config');
  assert.ok(cfg,'Expected one config event');
  assert.equal(cfg.candidatePolicy,'adaptive-feature-v1');
  assert.equal(cfg.budget,6000,'Adaptive candidate must never exceed 6s');
  assert.ok([1000,6000].includes(cfg.opponentBudget));
  if(opponentBudgetMs!==undefined)assert.equal(cfg.opponentBudget,opponentBudgetMs);
  assert.equal(cfg.candidateClockDivisor,12);
  assert.equal(cfg.opponentClockDivisor,12);
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:6000,expectedOpponentBudget:cfg.opponentBudget,
  });
  const games=events.filter(x=>x?.event==='game');
  const candidateTurns=games.flatMap(g=>g.turns.filter(t=>t.engine==='candidate'));
  const opponentTurns=games.flatMap(g=>g.turns.filter(t=>t.engine==='opponent'));
  assert.ok(candidateTurns.length&&opponentTurns.length);
  const reasonCounts={};
  for(const turn of candidateTurns){
    assert.ok(turn.policyDecision&&turn.policyDecision.policy==='adaptive-feature-v1');
    const reason=turn.policyDecision.reason;
    reasonCounts[reason]=(reasonCounts[reason]||0)+1;
  }
  const avg=xs=>Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*1000)/1000;
  const endClocks=side=>games.map(g=>g.clocks[side==='adaptive'?g.candidateSide:1-g.candidateSide]);
  const capClocks=side=>games.filter(g=>g.reason==='ply-cap')
    .map(g=>g.clocks[side==='adaptive'?g.candidateSide:1-g.candidateSide]);
  const details=side=>{
    const clocks=endClocks(side),capped=capClocks(side);
    const turns=side==='adaptive'?candidateTurns:opponentTurns;
    const perf=base.performance[side==='adaptive'?'candidate':'opponent'];
    return {
      searches:turns.length,
      meanActualThinkMs:perf.meanElapsedMs,
      meanDepth:perf.meanSearchDepth,
      meanNodes:perf.meanNodes,
      meanClockChargeMs:perf.meanClockChargeMs,
      meanRequestedThinkMs:avg(turns.map(t=>t.requestMs)),
      meanFinalRemainingSeconds:avg(clocks)/1000,
      meanCappedRemainingSeconds:capped.length?avg(capped)/1000:null,
      gamesUnder1s:clocks.filter(x=>x<1000).length,
      clockLosses:games.filter(g=>g.reason==='clock'
        &&g.winner===(side==='adaptive'?1-g.candidateSide:g.candidateSide)).length,
    };
  };
  return {
    event:'adaptive-selective-thinking-relative',
    status:'exploratory-not-calibrated',
    adaptiveMaxMs:6000,baselineFixedMaxMs:cfg.opponentBudget,
    games:games.length,pairedOpeningSets:base.pairedOpeningSets,
    adaptiveWins:base.candidateWins,baselineWins:base.opponentWins,
    neutralUndecided:base.neutralUndecided,
    cappedNeutral:games.filter(g=>g.reason==='ply-cap').length,
    adaptive:details('adaptive'),fixed:details('fixed'),
    decisionCounts:reasonCounts,
    source:base.source,
    rankCalibrated:false,gamePresetChanged:false,
    warning:'Selective-thinking heuristic is UNPROVEN. A sample of paired games cannot establish stronger play. '+
      'No Elo or amateur ranks; neutral outcomes stay undecided. '+
      'Feature costs debited, but native performance, rendering and 1% events vary by environment.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,path,fixedMs]=process.argv;
  assert.ok(path,'Usage: node adaptive-scorecard.mjs games.jsonl [1000|6000]');
  const rows=readFileSync(resolve(path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarizeAdaptiveTrial(rows,{
    opponentBudgetMs:fixedMs===undefined?undefined:Number(fixedMs),
  })));
}
