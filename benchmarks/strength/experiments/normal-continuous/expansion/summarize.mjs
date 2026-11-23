import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const cells = [];
const campaigns = [];
const combinedPairs = new Map();
const cents = value => Math.round(value * 100) / 100;
function percentile95(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a,b)=>a-b);
  return cents(sorted[Math.ceil(sorted.length*0.95)-1]);
}
function rowStats(games, engine, side) {
  const wins = games.filter(game => game.winner === side(game)).length;
  const unresolved = games.filter(game => game.reason === 'ply-cap').length;
  const draws = games.filter(game => game.winner === null && game.reason !== 'ply-cap').length;
  const losses = games.length - wins - draws - unresolved;
  const sum = field => games.reduce((total,game) => total + game[engine][field], 0);
  const moves = sum('moves');
  const avg = field => moves ? cents(sum(field) / moves) : null;
  const cpuSamples = sum('cpuSamples');
  const engineId = engine === 'candidate' ? 0 : 1;
  const turns = games.flatMap(game => game.turns.filter(turn=>turn.engine===engineId));
  assert.equal(turns.length,moves,'Per-turn telemetry count mismatch');
  assert.equal(turns.filter(turn=>Number.isFinite(turn.cpuMs)).length,cpuSamples,'Worker CPU accounting mismatch');
  return {wins,losses,draws,unresolved,moves,wallMeanMs:avg('wallMs'),
    wallP95Ms:percentile95(turns.map(turn=>turn.wallMs)),
    wallMaxMs:moves ? cents(Math.max(...games.map(game => game[engine].maxMs))) : null,
    cpuSamples,cpuTotalMs:cents(sum('cpuMs')),cpuMeanMs:cpuSamples ? cents(sum('cpuMs')/cpuSamples) : null,
    cpuP95Ms:percentile95(turns.map(turn=>turn.cpuMs).filter(Number.isFinite)),
    searchCpuMeanMs:cpuSamples ? cents(sum('searchCpuMs')/cpuSamples) : null,
    meanReportedMs:avg('engineMs'),meanDepth:avg('depth'),meanNodes:avg('nodes'),
    over5ms:sum('over5ms'),over50ms:sum('over50ms'),illegal:sum('illegal'),fallback:sum('fallback'),timeout:sum('timeout'),
    clockFlags:games.filter(game => game.reason === 'flag' && game.winner !== side(game)).length,
    resign:sum('resign'),declaration:sum('declaration')};
}
const sideOf = game => game.candidateSide;
const otherSide = game => 1-game.candidateSide;
function sideResult(games, side) {
  return {
    wins: games.filter(game => game.winner === side(game)).length,
    losses: games.filter(game => game.winner === 1 - side(game)).length,
    draws: games.filter(game => game.winner === null && game.reason !== 'ply-cap').length,
    unresolved: games.filter(game => game.reason === 'ply-cap').length,
  };
}
function rowResults(pairs) {
  const balanced = [...pairs.values()].filter(pair => pair.size === 2);
  const games = balanced.flatMap(pair => [...pair.values()]);
  const unpaired = pairs.size - balanced.length;
  const candidates = games.length ? rowStats(games,'candidate',sideOf) : null;
  const opponent = games.length ? rowStats(games,'opponent',otherSide) : null;
  const outcomes = games.map(({pair,candidateSide,winner,reason,plies,family}) => ({pair,candidateSide,winner,reason,plies,family}));
  const lower = games.length ? (candidates.wins + candidates.draws/2)/games.length : null;
  const upper = games.length ? lower + candidates.unresolved/games.length : null;
  const radius = games.length ? Math.sqrt(Math.log(40)/games.length) : null;
  const pct = value => Math.round(Math.min(1,Math.max(0,value))*10000)/100;
  const pairedDirections = {positive:0, negative:0, equal:0, unresolved:0};
  for (const pair of balanced) {
    const outcomes = sideResult([...pair.values()], sideOf);
    const fixed = outcomes.wins + outcomes.draws/2;
    if (fixed > 1) pairedDirections.positive++;
    else if (fixed + outcomes.unresolved < 1) pairedDirections.negative++;
    else if (outcomes.unresolved) pairedDirections.unresolved++;
    else pairedDirections.equal++;
  }
  return {sample:games.length,pairs:balanced.length,unpaired,candidates,opponent,outcomes,
    sente:sideResult(games.filter(game => game.candidateSide === 0),sideOf),
    gote:sideResult(games.filter(game => game.candidateSide === 1),sideOf),
    byEngineColor:games.length ? {
      candidateSente:rowStats(games.filter(game=>game.candidateSide===0),'candidate',sideOf),
      candidateGote:rowStats(games.filter(game=>game.candidateSide===1),'candidate',sideOf),
      opponentSente:rowStats(games.filter(game=>game.candidateSide===1),'opponent',otherSide),
      opponentGote:rowStats(games.filter(game=>game.candidateSide===0),'opponent',otherSide),
    } : null,
    pairedDirections,
    observedScoreRangePct:lower === null ? null : [pct(lower),pct(upper)],
    illustrativePaired95Pct: lower === null ? null : [pct(lower-radius),pct(upper+radius)]};
}
function addCombined(key,pairKey,game) {
  if (!combinedPairs.has(key)) combinedPairs.set(key,new Map());
  const pairs = combinedPairs.get(key);
  if (!pairs.has(pairKey)) pairs.set(pairKey,new Map());
  const games = pairs.get(pairKey);
  assert.ok(!games.has(game.candidateSide), `Duplicate combined row ${key} ${pairKey} ${game.candidateSide}`);
  games.set(game.candidateSide,game);
}
const fixtures = new Map(readFileSync(new URL('openings.jsonl',root),'utf8').trim().split('\n')
  .map(JSON.parse).filter(row=>row.event==='opening').map(row=>[`${row.level} ${row.family} ${row.pair}`,row.opening]));
for (const file of readdirSync(root).filter(name => /^match-.*\.jsonl$/.test(name)).sort()) {
  const raw = readFileSync(new URL(file, root), 'utf8');
  const rows = raw.split('\n').flatMap((line,index,lines) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch (error) {
      if (index===lines.length-1 && !raw.endsWith('\n')) return [];
      throw error;
    }
  });
  if (!rows.length) continue;
  const config = rows[0];
  assert.equal(config.event, 'config');
  const seeds = new Map();
  const games = rows.filter(row=>row.event==='game');
  const starts = rows.filter(row=>row.event==='game-start');
  for (const row of [...games,...starts]) {
    const fixture = fixtures.get(`${row.level} ${row.family} ${row.pair}`);
    assert.ok(fixture,`Unregistered start in ${file}`);
    assert.equal(row.opening,fixture,`Start differs from frozen fixture in ${file}`);
  }
  const progress = rows.at(-1);
  campaigns.push({file,config,planned:config.levels.length*config.families.length*config.pairCount*2,
    started:starts.length,finished:games.length,lastEvent:progress.event,
    lastGameStart:starts.length ? starts.at(-1) : null,lastProgressPly:progress.event==='progress' ? progress.plies : null});
  for (const game of games) {
    const key = `${game.family} ${game.level}`;
    if (!seeds.has(key)) seeds.set(key,new Map());
    const pairs = seeds.get(key);
    if (!pairs.has(game.pair)) pairs.set(game.pair,new Map());
    const pair = pairs.get(game.pair);
    assert.ok(!pair.has(game.candidateSide),`Duplicate ${file} ${key} ${game.pair} ${game.candidateSide}`);
    pair.set(game.candidateSide,game);
    const opponentKey = config.opponent === 'suisho5' ? `suisho5 nodes ${config.referenceNodes}` :
      config.sharedNodes ? `stock nodes ${config.sharedNodes}` : 'stock timed';
    addCombined(`${opponentKey} ${game.level} ${game.family}`,game.pair,game);
    if (opponentKey === 'stock timed') {
      addCombined(`${opponentKey} ${game.level} pooled`,`${game.family}:${game.pair}`,game);
    }
  }
  for (const [key, pairs] of seeds) {
    cells.push({file,key,opponentEngine:config.opponent,referenceNodes:config.referenceNodes,sharedNodes:config.sharedNodes,
      ...rowResults(pairs)});
  }
}
const combined = [...combinedPairs].map(([key,pairs]) => ({key,...rowResults(pairs)}));
console.log(JSON.stringify({total:cells.reduce((sum,cell)=>sum+cell.sample,0),campaigns,cells,combined},null,2));
