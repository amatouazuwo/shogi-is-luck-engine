import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreDifficultyGames} from './difficulty-scorecard.mjs';

// This validates relative strengths of the same rsshogi under obstacle rules.
// Gikou2 is never used on obstacle boards, and no amateur rank is certified.
const IDS=[21,22,23,24,25,26];
const STAGES=['opening','middle','reduced'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const summarise=rows=>{
  const wins=rows.filter(g=>g.winner===g.candidateSide).length;
  const losses=rows.filter(g=>g.winner!==null&&g.winner!==g.candidateSide).length;
  const neutral=rows.filter(g=>g.winner===null).length;
  return {games:rows.length,candidateWins:wins,opponentWins:losses,
    neutralUndecided:neutral};
};

export function auditProvisionalFourDanSpecial(events,source,opponentNodes){
  assert.ok([10000,50000].includes(opponentNodes),'Unexpected opponent node tier');
  assert.ok(typeof source==='string'&&source.trim(),'Missing archived obstacle fixtures');
  const configs=events.filter(e=>e?.event==='config');
  assert.equal(configs.length,1,'Exactly one match configuration required');
  const cfg=configs[0];
  assert.equal(cfg.fixtureSha,hash(source),'Fixture fingerprint mismatch');
  assert.equal(cfg.pairs,6);assert.equal(cfg.offset,0);assert.equal(cfg.cap,300);
  assert.equal(cfg.clockMs,180000);
  assert.equal(cfg.budget,1000);assert.equal(cfg.opponentBudget,1000);
  assert.equal(cfg.candidatePolicy,'fixed');assert.equal(cfg.opponentPolicy,'fixed');
  assert.equal(cfg.clockDelayMethod,'virtual-debit-not-wall-wait');
  assert.equal(cfg.candidateClockDivisor,20);assert.equal(cfg.opponentClockDivisor,20);
  assert.equal(cfg.candidatePreMoveDelayMs,1300);
  assert.equal(cfg.opponentPreMoveDelayMs,1300);
  assert.equal(cfg.candidateDepthCap,64);assert.equal(cfg.opponentDepthCap,64);
  assert.equal(cfg.candidateNodesCap,25000,'Candidate must be 25,000 nodes');
  assert.equal(cfg.opponentNodesCap,opponentNodes,'Incorrect reference node tier');
  const rows=source.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,12,'Six families x two obstacle types required');
  const sourceByKey=new Map();
  for(const f of rows){
    assert.equal(f.event,'opening');
    assert.ok(IDS.includes(f.pair),'Unreviewed opening family');
    assert.ok(STAGES.includes(f.stage),'Unreviewed position stage');
    assert.ok(['pit','blackhole'].includes(f.kind));
    assert.ok(Array.isArray(f.holes)&&f.holes.length>0);
    assert.ok(Number.isSafeInteger(f.legal)&&f.legal>0);
    const key=f.pair+':'+f.kind;
    assert.ok(!sourceByKey.has(key),'Duplicate archived obstacle board');
    sourceByKey.set(key,f);
  }
  for(const id of IDS){
    const two=rows.filter(f=>f.pair===id);
    assert.equal(two.length,2,'Missing paired obstacle family');
    assert.deepEqual(two.map(f=>f.kind).sort(),['blackhole','pit']);
    assert.equal(two[0].stage,two[1].stage,'Inconsistent stage labels');
  }
  const base=scoreDifficultyGames(events,{
    expectedCandidateBudget:1000,expectedOpponentBudget:1000});
  const games=events.filter(e=>e?.event==='game');
  const seen=new Set();
  for(const g of games){
    const key=g.pair+':'+g.kind;
    const f=sourceByKey.get(key);
    assert.ok(f,'Unknown obstacle opening');
    assert.equal(g.start,f.sfen,'Starting SFEN changed');
    assert.deepEqual(g.holes,f.holes,'Obstacle positions changed');
    const id=key+':'+g.candidateSide;
    assert.ok(!seen.has(id),'Duplicate color-swapped match');
    seen.add(id);
    for(const turn of g.turns){
      const candidate=turn.engine==='candidate';
      const limit=candidate?25000:opponentNodes;
      assert.equal(turn.nodesCap,limit,'Per-move cap changed');
      assert.equal(turn.depthCap,64,'Search depth cap changed');
      assert.ok(Number.isInteger(turn.nodes)&&turn.nodes>=0&&turn.nodes<=limit,
        'Actual node count outside requested cap');
      assert.ok(Number.isInteger(turn.depth)&&turn.depth>=0&&turn.depth<=64,
        'Invalid actual search depth');
      assert.ok(Number.isFinite(turn.score),'Missing search score');
      assert.ok(Array.isArray(turn.pv),'Missing PV');
      if(turn.pv.length)assert.equal(turn.pv[0],turn.move,'PV disagrees with bestmove');
    }
  }
  assert.equal(seen.size,24,'All 24 uniquely paired games required');
  const stages=Object.fromEntries(STAGES.map(stage=>[stage,summarise(games.filter(g=>
    sourceByKey.get(g.pair+':'+g.kind).stage===stage))]));
  for(const v of Object.values(stages))assert.equal(v.games,8,'Two families per stage');
  const result={event:'provisional-four-dan-special-board-relative-audit',
    status:'verified-relative-only',comparison:{candidateNodes:25000,opponentNodes,
      depthCap:64,moveTimeLimitMs:1000,virtualClockMs:180000,plyCap:300},
    candidateWins:base.candidateWins,opponentWins:base.opponentWins,
    neutralUndecided:base.neutralUndecided,scoreBounds:base.scoreBoundsIncludingNeutral,
    byObstacle:base.breakdownByObstacle,stages,actual:base.performance,
    sameWasmAndWorker:base.sameModelAndWorker,
    source:base.source,gameDifficultyChanged:false,
    fourDanCertified:false,
    caveat:'25k is a development candidate only. Same-model obstacle results cannot verify amateur rank; neutral games are not losses.'};
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,resultPath,fixturePath,opponentArg]=process.argv;
  assert.ok(resultPath&&fixturePath&&opponentArg,
    'Usage: node provisional-four-dan-special-scorecard.mjs RESULTS.jsonl FIXTURES.jsonl OPPONENT_NODES');
  const events=readFileSync(resolve(resultPath),'utf8').trim().split('\n').map(JSON.parse);
  const fixtures=readFileSync(resolve(fixturePath),'utf8');
  console.log(JSON.stringify(auditProvisionalFourDanSpecial(events,fixtures,Number(opponentArg))));
}
