import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreSearchAxisGames} from './search-axis-scorecard.mjs';

// Validate *original* archived opening metadata independently of the game logs.
// This prevents accidental stage labels, source positions or obstacle layouts
// from being silently changed when measuring robustness.
const sha256=text=>createHash('sha256').update(text).digest('hex');
const mean=xs=>xs.length
  ?Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*1000)/1000:null;
const STAGES=['opening','middle','reduced'];
const FAMILY_IDS=[21,22,23,24,25,26];

export function summarizeSearchAxisAcrossStages(events,rawFixtures,axis){
  assert.ok(typeof rawFixtures==='string'&&rawFixtures.trim(),'Fixtures are required');
  const cfg=events.filter(x=>x?.event==='config');
  assert.equal(cfg.length,1,'Exactly one run config required');
  assert.equal(cfg[0].pairs,6,'Must check all six source families');
  assert.equal(cfg[0].offset,0,'Must start at first archived source family');
  assert.equal(cfg[0].cap,300,'Keep neutral 300-ply stopping point');
  assert.equal(cfg[0].fixtureSha,sha256(rawFixtures),
    'Actual game source fixture hash must match verified input file');
  const fixtureRows=rawFixtures.trim().split('\n').map(JSON.parse);
  assert.equal(fixtureRows.length,12,'Require six families with two obstacle boards each');
  const byKey=new Map(),families=new Map();
  for(const f of fixtureRows){
    assert.equal(f.event,'opening');
    assert.ok(STAGES.includes(f.stage),'Unknown opening stage');
    assert.ok(FAMILY_IDS.includes(f.pair),'Unexpected family identifier');
    assert.ok(['pit','blackhole'].includes(f.kind),'Unknown obstacle');
    assert.ok(typeof f.sfen==='string'&&f.sfen.length>0,'Missing source SFEN');
    assert.ok(Array.isArray(f.holes)&&f.holes.length>0,'Missing actual obstacles');
    assert.ok(Number.isInteger(f.legal)&&f.legal>0,'Missing archived legal count');
    const key=f.pair+':'+f.kind;
    assert.ok(!byKey.has(key),'Duplicate family+obstacle: '+key);
    byKey.set(key,f);
    if(!families.has(f.pair))families.set(f.pair,[]);
    families.get(f.pair).push(f);
  }
  assert.deepEqual([...families.keys()].sort((a,b)=>a-b),FAMILY_IDS);
  for(const [id,variants] of families){
    assert.deepEqual(variants.map(x=>x.kind).sort(),['blackhole','pit'],
      'Each source family must have both obstacle styles: '+id);
    assert.equal(new Set(variants.map(x=>x.stage)).size,1,
      'Both obstacle layouts of a source family must share a stage: '+id);
  }
  for(const stage of STAGES){
    assert.equal([...families.values()].filter(a=>a[0].stage===stage).length,2,
      'Exactly two source families required for stage '+stage);
  }
  // Legacy scorer performs the independent same-model, clock, per-move
  // configured search-axis audit and reversed-color validation.
  const base=summarizeBase(events,axis);
  const games=events.filter(x=>x?.event==='game');
  assert.equal(games.length,24,'Six source families x two obstacles x two colors');
  const annotated=games.map(game=>{
    const f=byKey.get(game.pair+':'+game.kind);
    assert.ok(f,'Unknown game source family or kind');
    assert.equal(game.start,f.sfen,'Opening SFEN must match fixture');
    assert.deepEqual(game.holes,f.holes,'Obstacle mask must match fixture');
    return {stage:f.stage,game};
  });
  const summarizeGames=rows=>{
    const wins=rows.filter(({game:g})=>g.winner===g.candidateSide).length;
    const losses=rows.filter(({game:g})=>g.winner!==null&&g.winner!==g.candidateSide).length;
    const neutral=rows.filter(({game:g})=>g.winner===null).length;
    const turns=side=>rows.flatMap(({game:g})=>g.turns.filter(t=>t.engine===side));
    const profile=side=>{
      const t=turns(side),isCandidate=side==='candidate';
      const clocks=rows.map(({game:g})=>g.clocks[isCandidate?g.candidateSide:1-g.candidateSide]);
      return {
        actualNativeMoves:t.length,
        meanDepth:mean(t.map(z=>z.depth)),
        meanNodes:mean(t.map(z=>z.nodes)),
        meanSearchMs:mean(t.map(z=>z.elapsed)),
        meanAllocatedMs:mean(t.map(z=>z.requestMs)),
        meanFinalClockSeconds:mean(clocks.map(n=>n/1000)),
        clockLosses:rows.filter(({game:g})=>g.reason==='clock'&&
          g.winner===(isCandidate?1-g.candidateSide:g.candidateSide)).length,
      };
    };
    assert.equal(wins+losses+neutral,rows.length);
    return {
      games:rows.length,
      highLimitWins:wins,lowLimitWins:losses,neutralUndecided:neutral,
      highLimitScoreBounds:rows.length?
        [Math.round(wins/rows.length*10000)/10000,
         Math.round((wins+neutral)/rows.length*10000)/10000]:null,
      highLimit:profile('candidate'),lowLimit:profile('opponent'),
    };
  };
  const stages={};
  for(const stage of STAGES){
    const subset=annotated.filter(row=>row.stage===stage);
    assert.equal(subset.length,8,'Two families, two obstacles, two colors per stage');
    const ids=[...new Set(subset.map(x=>x.game.pair))].sort((a,b)=>a-b);
    assert.equal(ids.length,2,'Stage observations should be two paired families');
    stages[stage]={
      sourceFamilies:ids,distinctStartingBoards:4,
      ...summarizeGames(subset),
      byObstacle:Object.fromEntries(['pit','blackhole'].map(kind=>[
        kind,summarizeGames(subset.filter(x=>x.game.kind===kind)),
      ])),
    };
  }
  const pairs=Object.fromEntries(FAMILY_IDS.map(id=>{
    const data=annotated.filter(x=>x.game.pair===id);
    assert.equal(data.length,4);
    return [String(id),{stage:data[0].stage,...summarizeGames(data)}];
  }));
  return {
    event:'search-axis-multistage-validation',axis,
    status:'exploratory-not-calibrated',
    dataSource:'archived-preexisting-special-board-openings',
    sourceFamilyCount:families.size,distinctStartingBoards:12,
    openingStageMeaning:'Archived tags opening/middle/reduced; reduced is NOT a certified endgame puzzle',
    ...summarizeGames(annotated),
    stages,pairs,
    source:base.source,
    sameModelAndWorker:true,
    gameDifficultyChanged:false,amateurRankValidated:false,
    caution:'24 games share only six source families with reverse-color pairs. '+
      'Correlated samples, previously archived boards (not sealed unseen human tests), '+
      'and no 1% events or browser device latency. Win rates cannot certify amateur ranks. '+
      'Any 300-ply or unresolved repetition ends as NEUTRAL, never a loss or draw.',
  };
}

function summarizeBase(events,axis){
  return scoreSearchAxisGames(events,axis);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [, ,resultsPath,fixturesPath,axis]=process.argv;
  assert.ok(resultsPath&&fixturesPath&&axis,
    'Usage: node search-axis-stage-scorecard.mjs RESULTS.jsonl FIXTURES.jsonl depth|nodes');
  const games=readFileSync(resolve(resultsPath),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const fixtures=readFileSync(resolve(fixturesPath),'utf8');
  console.log(JSON.stringify(summarizeSearchAxisAcrossStages(games,fixtures,axis)));
}
