import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

const mean=xs=>xs.length?Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*1000)/1000:null;
export function scoreSearchAxisGames(events,axis) {
  assert.ok(['depth','nodes'].includes(axis),'Unknown search axis');
  const configs=events.filter(x=>x?.event==='config');
  assert.equal(configs.length,1,'Expected exactly one configuration');
  const cfg=configs[0];
  assert.equal(cfg.opponent,'baseline','Both opponents must use real Workers');
  assert.equal(cfg.budget,1000);assert.equal(cfg.opponentBudget,1000);
  assert.equal(cfg.clockMs,180000);
  assert.equal(cfg.candidatePolicy,'fixed');assert.equal(cfg.opponentPolicy,'fixed');
  assert.equal(cfg.clockDelayMethod,'virtual-debit-not-wall-wait');
  assert.equal(cfg.candidateClockDivisor,20);assert.equal(cfg.opponentClockDivisor,20);
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  assert.deepEqual([cfg.candidateDepthCap,cfg.opponentDepthCap],
    axis==='depth'?[4,2]:[64,64], 'Unexpected depth comparison values');
  assert.deepEqual([cfg.candidateNodesCap,cfg.opponentNodesCap],
    axis==='depth'?[250000,250000]:[10000,500], 'Unexpected node comparison values');
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:1000,expectedOpponentBudget:1000});
  const games=events.filter(x=>x?.event==='game');
  const stats=who=>{
    const candidate=who==='candidate';
    const depthCap=candidate?cfg.candidateDepthCap:cfg.opponentDepthCap;
    const nodesCap=candidate?cfg.candidateNodesCap:cfg.opponentNodesCap;
    const turns=games.flatMap(g=>g.turns.filter(t=>t.engine===who));
    assert.ok(turns.length>0,'Missing engine searches');
    for(const t of turns){
      assert.equal(t.depthCap,depthCap,'Per-move depth cap changed');
      assert.equal(t.nodesCap,nodesCap,'Per-move node cap changed');
      assert.ok(Number.isSafeInteger(t.depth)&&t.depth>=0&&t.depth<=depthCap,
        'Actual search exceeded depth cap');
      assert.ok(Number.isSafeInteger(t.nodes)&&t.nodes>=0&&t.nodes<=nodesCap,
        'Actual search exceeded node cap');
      assert.ok(Number.isFinite(t.score),'Missing numeric search score');
      assert.ok(Array.isArray(t.pv)&&t.pv.every(x=>typeof x==='string'),
        'Expected one ordered bestmove PV, not a MultiPV list');
      if(t.pv.length)assert.equal(t.pv[0],t.move,'PV first move mismatch');
    }
    const clocks=games.map(g=>g.clocks[candidate?g.candidateSide:1-g.candidateSide]);
    const perf=base.performance[who];
    return {
      depthCap,nodesCap,actualMoves:turns.length,
      meanObservedDepth:perf.meanSearchDepth,
      meanObservedNodes:perf.meanNodes,
      meanSearchMilliseconds:perf.meanElapsedMs,
      meanAllocatedMilliseconds:mean(turns.map(t=>t.requestMs)),
      meanClockChargeMilliseconds:perf.meanClockChargeMs,
      meanFinalClockSeconds:mean(clocks.map(x=>x/1000)),
      leastFinalClockSeconds:Math.round(Math.min(...clocks))/1000,
      clockLosses:games.filter(g=>g.reason==='clock'&&
        g.winner===(candidate?1-g.candidateSide:g.candidateSide)).length,
    };
  };
  return {
    event:'native-search-axis-head-to-head',
    axis,status:'small-sample-not-amateur-rank',
    gameCount:base.games,
    distinctPairedOpeningKinds:base.pairedOpeningSets,
    candidateWins:base.candidateWins,
    opponentWins:base.opponentWins,
    neutralUndecided:base.neutralUndecided,
    candidateScoreBounds:base.scoreBoundsIncludingNeutral,
    obstacleBreakdown:base.breakdownByObstacle,
    strongerControl:stats('candidate'),weakerControl:stats('opponent'),
    source:base.source,
    humanAmateurRankCalibrated:false,
    gameDifficultyChanged:false,
    limitations:'Four paired games are insufficient to establish Elo or amateur rank; '+
      'increasing search depth/node limit is not linearly proportional to strength. '+
      'Capped or repetition results are NEUTRAL. The official browser and 1% effects are not simulated.',
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,path,axis]=process.argv;
  assert.ok(path,'Usage: node search-axis-scorecard.mjs RESULTS.jsonl depth|nodes');
  const events=readFileSync(resolve(path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(scoreSearchAxisGames(events,axis)));
}
