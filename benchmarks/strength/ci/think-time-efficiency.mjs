import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

// A fixed-thinking-cap comparison within the SAME rsshogi. Relative results
// only; depth, nodes and clock savings are not strength multipliers or Elo.
export function summarizeThinkTimeEfficiency(events,{expectedCandidateMs}={}){
  const cfg=events.find(x=>x?.event==='config');
  assert.ok(cfg,'Missing game configuration');
  assert.ok([1000,3000].includes(cfg.budget),'Candidate should be 1s or 3s');
  assert.equal(cfg.opponentBudget,6000,'Reference must use fixed 6s ceiling');
  if(expectedCandidateMs!==undefined)assert.equal(cfg.budget,expectedCandidateMs);
  assert.equal(cfg.candidateClockDivisor,12,'Both clock fractions must be identical');
  assert.equal(cfg.opponentClockDivisor,12,'Both clock fractions must be identical');
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  assert.equal(cfg.clockDelayMethod,'virtual-debit-not-wall-wait');
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:cfg.budget,expectedOpponentBudget:6000,
  });
  const rounds=events.filter(x=>x?.event==='game');
  const bySide=candidate=>{
    const positions=rounds.map(g=>g.clocks[candidate?g.candidateSide:1-g.candidateSide]);
    const capped=rounds.filter(g=>g.reason==='ply-cap').map(g=>g.clocks[candidate?g.candidateSide:1-g.candidateSide]);
    const moves=rounds.flatMap(g=>g.turns.filter(t=>t.engine===(candidate?'candidate':'opponent')));
    const average=arr=>arr.length?Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100)/100:null;
    return {
      averageFinalClockSeconds:average(positions.map(x=>x/1000)),
      minimumFinalClockSeconds:Math.round(Math.min(...positions)/10)/100,
      cappedPositionsAverageRemainingSeconds:average(capped.map(x=>x/1000)),
      meanRequestedMs:average(moves.map(x=>x.requestMs)),
      meanDepth:base.performance[candidate?'candidate':'opponent'].meanSearchDepth,
      meanElapsedMs:base.performance[candidate?'candidate':'opponent'].meanElapsedMs,
      meanNodes:base.performance[candidate?'candidate':'opponent'].meanNodes,
      actualMoves:moves.length,
    };
  };
  const short=bySide(true),long=bySide(false);
  return {
    event:'rsshogi-diminishing-time-returns',
    status:'exploratory-sample',
    sameEngineWasmAndWorker:true,
    comparablePolicy:'both /12 of remaining clock, same 1300ms pre-move delay',
    shortBudgetMs:cfg.budget,referenceBudgetMs:6000,
    games:base.games,pairedOpeningSets:base.pairedOpeningSets,
    shortWins:base.candidateWins,longWins:base.opponentWins,
    undecidedNeutral:base.neutralUndecided,
    shortScoreBounds:base.scoreBoundsIncludingNeutral,
    short,
    long,
    depthGainFromLongThink:
      Math.round((long.meanDepth-short.meanDepth)*1000)/1000,
    clockSavedByShortAtEndSeconds:
      Math.round((short.averageFinalClockSeconds-long.averageFinalClockSeconds)*100)/100,
    sameClockPolicy:true,
    source:base.source,
    rankCalibrated:false,
    autoChangeCpuSettings:false,
    caution:'Depth or thinking time are NOT linear measures of strength. '+
      'Small correlated games, with capped ones neutral, cannot establish Elo or amateur ranks. '+
      'No 1% events, UI lag or device thermal throttling in this run.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,filename,budget]=process.argv;
  assert.ok(filename,'Usage: node think-time-efficiency.mjs results.jsonl [1000|3000]');
  const data=readFileSync(resolve(filename),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarizeThinkTimeEfficiency(data,{expectedCandidateMs:budget?Number(budget):undefined})));
}
