import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const cells = [];
const combinedPairs = new Map();
function rowStats(games, engine, side) {
  const wins = games.filter(game => game.winner === side(game)).length;
  const unresolved = games.filter(game => game.reason === 'ply-cap').length;
  const draws = games.filter(game => game.winner === null && game.reason !== 'ply-cap').length;
  const losses = games.length - wins - draws - unresolved;
  const sum = field => games.reduce((total,game) => total + game[engine][field], 0);
  const moves = sum('moves');
  const avg = field => Math.round(sum(field) * 100 / moves) / 100;
  return {wins,losses,draws,unresolved,moves,wallMeanMs:avg('wallMs'),
    wallMaxMs:Math.max(...games.map(game => game[engine].maxMs)),
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
for (const file of readdirSync(root).filter(name => /^match-.*\.jsonl$/.test(name)).sort()) {
  const rows = readFileSync(new URL(file, root), 'utf8').trim().split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  if (!rows.length) continue;
  const config = rows[0];
  assert.equal(config.event, 'config');
  const seeds = new Map();
  for (const game of rows.filter(row => row.event === 'game')) {
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
    if (opponentKey === 'stock timed' && game.level === 100) {
      addCombined(`${opponentKey} ${game.level} pooled`,`${game.family}:${game.pair}`,game);
    }
  }
  for (const [key, pairs] of seeds) {
    cells.push({file,key,opponentEngine:config.opponent,referenceNodes:config.referenceNodes,sharedNodes:config.sharedNodes,
      ...rowResults(pairs)});
  }
}
const combined = [...combinedPairs].map(([key,pairs]) => ({key,...rowResults(pairs)}));
console.log(JSON.stringify({total:cells.reduce((sum,cell)=>sum+cell.sample,0),cells,combined},null,2));
