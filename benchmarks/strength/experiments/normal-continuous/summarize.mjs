import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const cells = [];
function rowStats(games, engine, side) {
  const wins = games.filter(game => game.winner === side(game)).length;
  const draws = games.filter(game => game.winner === null).length;
  const losses = games.length - wins - draws;
  const sum = field => games.reduce((total,game) => total + game[engine][field], 0);
  const moves = sum('moves');
  const avg = field => Math.round(sum(field) * 100 / moves) / 100;
  return {wins,losses,draws,moves,wallMeanMs:avg('wallMs'),
    wallMaxMs:Math.max(...games.map(game => game[engine].maxMs)),
    meanReportedMs:avg('engineMs'),meanDepth:avg('depth'),meanNodes:avg('nodes'),
    over5ms:sum('over5ms'),over50ms:sum('over50ms'),illegal:sum('illegal'),fallback:sum('fallback'),timeout:sum('timeout'),
    clockFlags:games.filter(game => game.reason === 'flag' && game.winner !== side(game)).length,
    resign:sum('resign'),declaration:sum('declaration')};
}
const sideOf = game => game.candidateSide;
const otherSide = game => 1-game.candidateSide;
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
  }
  for (const [key, pairs] of seeds) {
    const balanced = [...pairs.values()].filter(pair => pair.size === 2);
    const games = balanced.flatMap(pair => [...pair.values()]);
    const unpaired = pairs.size - balanced.length;
    const candidates = games.length ? rowStats(games,'candidate',sideOf) : null;
    const opponent = games.length ? rowStats(games,'opponent',otherSide) : null;
    const outcomes = games.map(({pair,candidateSide,winner,reason,plies}) => ({pair,candidateSide,winner,reason,plies}));
    cells.push({file,key,opponentEngine:config.opponent,referenceNodes:config.referenceNodes,sharedNodes:config.sharedNodes,
      sample:games.length,unpaired,candidates,opponent,outcomes});
  }
}
console.log(JSON.stringify({total:cells.reduce((sum,cell)=>sum+cell.sample,0),cells},null,2));
