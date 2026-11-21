import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const local = new URL('./',import.meta.url);
const files = readdirSync(local).filter(name => /^normal-(?:hirate|game)-.*\.jsonl$/.test(name)).sort();
const cells = new Map();
const configs = [];
for (const file of files) {
  const rows = readFileSync(new URL(file,local),'utf8').trim().split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  if (!rows.length) continue;
  assert.equal(rows[0].event,'config',file);
  configs.push({file,...rows[0]});
  for (const row of rows.filter(row => row.event === 'game')) {
    const key = `${row.family} ${row.level}`;
    if (!cells.has(key)) cells.set(key,new Map());
    const cell = cells.get(key);
    if (!cell.has(row.pair)) cell.set(row.pair,new Map());
    const pair = cell.get(row.pair);
    assert.ok(!pair.has(row.stockSide),`Duplicate ${key} ${row.pair} ${row.stockSide}`);
    pair.set(row.stockSide,row);
  }
}

const sum = (rows, get) => rows.reduce((total,row) => total+get(row),0);
const round = x => Math.round(x*100)/100;
const stockSide = row => row.stockSide;
const refSide = row => 1-row.stockSide;
function results(rows, side) {
  const wins = rows.filter(row => row.winner === side(row)).length;
  const draws = rows.filter(row => row.winner === null).length;
  return {wins, draws, losses:rows.length-wins-draws, winPct:round(100*wins/rows.length)};
}
function details(rows, type, side) {
  const moves = sum(rows,row => row[type].moves);
  const total = field => sum(rows,row => row[type][field]);
  const avg = field => round(total(field)/moves);
  return {
    ...results(rows,side),
    sente:results(rows.filter(row => side(row) === 0),side),
    gote:results(rows.filter(row => side(row) === 1),side),
    moves, clockFlags:rows.filter(row => row.reason === 'flag' && row.winner !== side(row)).length,
    illegal:total('illegal'), fallback:total('fallback'), timeout:total('timeout'), resign:total('resign'), declaration:total('declaration'),
    over5ms:total('over5ms'), over50ms:total('over50ms'), meanWallMs:avg('wallMs'),
    maxWallMs:round(Math.max(...rows.map(row => row[type].maxMs))), meanEngineMs:avg('engineMs'),
    meanNodes:avg('nodes'), meanDepth:avg('depth'),
  };
}
const summaries = [];
const incomplete = [];
const all = [];
for (const [key, cell] of [...cells.entries()].sort()) {
  const paired = [];
  for (const [pair, sides] of cell) {
    if (sides.size === 2) paired.push(...sides.values());
    else incomplete.push({key,pair,games:[...sides.values()].map(({stockSide,winner,reason,plies}) => ({stockSide,winner,reason,plies}))});
  }
  if (!paired.length) continue;
  all.push(...paired);
  const stock = details(paired,'stock',stockSide);
  const score = (stock.wins+0.5*stock.draws)/paired.length;
  const radius = Math.sqrt(Math.log(40)/paired.length);
  const score95 = [Math.max(0,score-radius),Math.min(1,score+radius)].map(x=>round(100*x));
  summaries.push({key,games:paired.length,score95,stock,reference:details(paired,'reference',refSide),
    results:paired.map(({stockSide,winner,reason,plies,pair}) => ({stockSide,winner,reason,plies,pair}))});
}
console.log(JSON.stringify({configs, games:all.length, cells:summaries, incomplete,
  ...(all.length ? {stock:details(all,'stock',stockSide),reference:details(all,'reference',refSide)} : {})},null,2));
