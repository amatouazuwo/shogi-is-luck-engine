import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {planTurn} from './clock-budget.mjs';

// Report *relative* engine strengths only. Never treat a capped game as a
// draw/loss or a move-time budget as proof of an amateur rank.
export function scoreDifficultyGames(events, {
  expectedCandidateBudget, expectedOpponentBudget,
}={}) {
  const configEvents=events.filter(x=>x?.event==='config');
  assert.equal(configEvents.length,1,'Exactly one run configuration is required');
  const config=configEvents[0];
  assert.ok(config.opponent==='baseline','Both players must use actual rsshogi');
  assert.equal(config.candidateSha,config.baselineSha,'Model and WASM must match');
  assert.equal(config.candidateWorkerSha,config.baselineWorkerSha,
    'Worker implementations must match');
  assert.ok([100,500,1500,6000].includes(config.budget));
  assert.ok([100,500,1500,6000].includes(config.opponentBudget));
  if (expectedCandidateBudget!==undefined)assert.equal(config.budget,expectedCandidateBudget);
  if (expectedOpponentBudget!==undefined)assert.equal(config.opponentBudget,expectedOpponentBudget);
  assert.ok(Number.isInteger(config.pairs)&&config.pairs>=1&&config.pairs<=6);
  assert.ok(Number.isInteger(config.cap)&&config.cap>=1&&config.cap<=300);
  const games=events.filter(x=>x?.event==='game');
  assert.equal(games.length,config.pairs*4,
    'Obstacle calibration requires both pit/blackhole and reversed colors');
  const groups=new Map();
  for(const game of games) {
    assert.ok(['pit','blackhole'].includes(game.kind));
    assert.ok(Number.isSafeInteger(game.pair));
    assert.ok(game.candidateSide===0||game.candidateSide===1);
    assert.ok(game.winner===null||game.winner===0||game.winner===1);
    assert.ok(['no-legal','resign','clock','ply-cap','repetition-unadjudicated'].includes(game.reason));
    if (['ply-cap','repetition-unadjudicated'].includes(game.reason))
      assert.equal(game.winner,null,'Unadjudicated positions must be neutral');
    if (['no-legal','resign','clock'].includes(game.reason))
      assert.notEqual(game.winner,null,'Decided games need a winner');
    assert.ok(Array.isArray(game.turns)&&game.turns.length<=config.cap);
    assert.ok(Array.isArray(game.clocks)&&game.clocks.length===2);
    assert.ok(game.clocks.every(t=>Number.isFinite(t)&&t<=180000),
      'Invalid remaining game clocks');
    assert.ok(typeof game.start==='string'&&game.start.trim().length>0);
    assert.ok(Array.isArray(game.holes));
    const key=game.kind+':'+game.pair;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(game);
    for (const turn of game.turns) {
      assert.ok(['candidate','opponent'].includes(turn.engine));
      assert.ok(Number.isFinite(turn.elapsed)&&turn.elapsed>=0);
      assert.ok(Number.isFinite(turn.requestMs)&&turn.requestMs>0);
      assert.ok(turn.requestMs<=
        (turn.engine==='candidate'?config.budget:config.opponentBudget));
      // New game-clock-aware trials must prove EVERY recorded search budget
      // came from the same policy as the game, including pre-move delay.
      if(config.clockDelayMethod==='virtual-debit-not-wall-wait'){
        const candidate=turn.engine==='candidate';
        const nominalMs=candidate?config.budget:config.opponentBudget;
        const divisor=candidate?config.candidateClockDivisor:config.opponentClockDivisor;
        const preMoveDelayMs=candidate?config.candidatePreMoveDelayMs:config.opponentPreMoveDelayMs;
        const plan=planTurn({remainingMs:turn.clockBeforeMs,nominalMs,divisor,preMoveDelayMs});
        assert.equal(turn.clockDivisor,divisor);
        assert.equal(turn.requestMs,plan.searchMs,'Observed Worker budget must match real game policy');
        assert.equal(turn.preMoveDelayChargedMs,plan.preMoveDelayChargedMs);
        assert.equal(turn.clockAfterDelayMs,plan.clockAfterDelayMs);
        assert.ok(Math.abs(turn.chargedMs-(turn.elapsed+plan.preMoveDelayChargedMs))<0.001);
        assert.ok(Math.abs(turn.clockAfterTurnMs-(plan.clockAfterDelayMs-turn.elapsed))<1.01,
          'Remaining time does not agree with search and pre-move delay');
      }
    }
  }
  assert.equal(groups.size,config.pairs*2,'Unexpected number of opening pairs');
  for(const [key,pair] of groups) {
    assert.equal(pair.length,2,'Missing color reversal '+key);
    assert.deepEqual(pair.map(x=>x.candidateSide).sort(),[0,1]);
    assert.equal(pair[0].start,pair[1].start,'A pair must use the same starting SFEN');
    assert.deepEqual(pair[0].holes,pair[1].holes);
  }
  const wins=games.filter(x=>x.winner!==null&&x.winner===x.candidateSide).length;
  const losses=games.filter(x=>x.winner!==null&&x.winner!==x.candidateSide).length;
  const undecided=games.filter(x=>x.winner===null).length;
  const scoreSide=side=>{
    const moves=games.flatMap(g=>g.turns.filter(t=>t.engine===side));
    const mean=field=>{
      const numbers=moves.map(t=>t[field]).filter(Number.isFinite);
      return numbers.length?Math.round(numbers.reduce((a,b)=>a+b,0)/numbers.length*1000)/1000:null;
    };
    return {
      nativeTurns:moves.length, meanSearchDepth:mean('depth'),
      meanElapsedMs:mean('elapsed'), meanNodes:mean('nodes'),
      overruns50ms:moves.filter(t=>t.elapsed>t.requestMs+50).length,
      meanClockChargeMs:mean('chargedMs'),
      totalPreMoveDelayMs:moves.reduce((sum,t)=>sum+(t.preMoveDelayChargedMs||0),0),
    };
  };
  const kindBreakdown=Object.fromEntries(['pit','blackhole'].map(kind=>{
    const rows=games.filter(g=>g.kind===kind);
    return [kind,{
      games:rows.length,
      candidateWins:rows.filter(g=>g.winner===g.candidateSide).length,
      opponentWins:rows.filter(g=>g.winner!==null&&g.winner!==g.candidateSide).length,
      undecided:rows.filter(g=>g.winner===null).length,
    }];
  }));
  const n=games.length;
  return {
    event:'amateur-tier-relative-scorecard',
    status:'sample-only',
    candidateBudgetMs:config.budget, opponentBudgetMs:config.opponentBudget,
    pairedOpeningSets:groups.size, games:n, candidateWins:wins,
    opponentWins:losses, neutralUndecided:undecided,
    scoreBoundsIncludingNeutral:[Math.round(wins/n*10000)/10000,
      Math.round((wins+undecided)/n*10000)/10000],
    candidateDecidedWinRate:wins+losses?Math.round(wins/(wins+losses)*10000)/10000:null,
    breakdownByObstacle:kindBreakdown,
    performance:{candidate:scoreSide('candidate'),opponent:scoreSide('opponent')},
    sameModelAndWorker:true,
    clockPolicy:config.clockDelayMethod?{
      method:config.clockDelayMethod,
      candidate:{divisor:config.candidateClockDivisor,preMoveDelayMs:config.candidatePreMoveDelayMs},
      opponent:{divisor:config.opponentClockDivisor,preMoveDelayMs:config.opponentPreMoveDelayMs},
      note:'Virtual pre-move delay is charged to actual 3-minute clocks; browser animations and hardware latencies not simulated.',
    }:null,
    source:{engineWasmSha256:config.candidateSha,
      workerSha256:config.candidateWorkerSha,
      fixtureSha256:config.fixtureSha, capPlies:config.cap},
    amateurRankValidation:'NOT_PERFORMED',
    autoAssignAmateurGrade:false,
    warning:'Paired same-engine matches show only relative behavior. '+
      'Unfinished/repetition positions are neutral; these small correlated '+
      'samples are not Elo or evidence of amateur 5-kyu / shodan / 4-dan.',
  };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [, ,path,candidate,opponent]=process.argv;
  assert.ok(path,'Usage: node difficulty-scorecard.mjs results.jsonl [candidateMs] [opponentMs]');
  const values=readFileSync(resolve(path),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const output=scoreDifficultyGames(values,{
    expectedCandidateBudget:candidate===undefined?undefined:Number(candidate),
    expectedOpponentBudget:opponent===undefined?undefined:Number(opponent),
  });
  console.log(JSON.stringify(output));
}
