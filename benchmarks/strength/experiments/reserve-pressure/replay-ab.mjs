import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [baselineDirectory, reserveDirectory, corpus, summary] = process.argv.slice(2);
assert.ok(baselineDirectory && reserveDirectory && corpus && summary,
  'node replay-ab.mjs BASELINE_SDK RESERVE_SDK CORPUS AB_SUMMARY');

function request(engine, command, options = {}) {
  const result = engine.request({command, ...options});
  assert.ok(result.ok, command + ': ' + result.error);
  return result.result ?? result;
}
async function open(directory) {
  const {MiniEngine} = await import(pathToFileURL(resolve(directory, 'mini.js')));
  const engine = await MiniEngine.create(readFileSync(resolve(directory, 'rsshogi_nnue_mini.wasm')));
  request(engine, 'load_embedded');
  request(engine, 'configure', {threads:1, hash_mb:16});
  return engine;
}
const positions = new Map(readFileSync(corpus, 'utf8').trim().split('\n')
  .map(JSON.parse).map(item => [item.id, item]));
const decisions = JSON.parse(readFileSync(summary, 'utf8')).decisions;
const changedIds = [...new Set(decisions.map(item => item.id))];
const engines = await Promise.all([open(baselineDirectory), open(reserveDirectory)]);
try {
  for (const id of changedIds) {
    const puzzle = positions.get(id);
    assert.ok(puzzle, id);
    for (const nodes of [4000, 20000]) {
      const results = engines.map(engine => {
        request(engine, 'new_game');
        request(engine, 'set_obstacle_position', {sfen:puzzle.sfen, holes:puzzle.holes});
        const staticScore = request(engine, 'evaluate').score;
        const {bestmove, depth, nodes:visited, score, pv} = request(engine, 'search', {depth:64, nodes});
        assert.ok(puzzle.available.includes(bestmove), id + ' returned an illegal move');
        return {staticScore, bestmove, depth, nodes:visited, score, pv,
          correct:puzzle.goodMoves.includes(bestmove)};
      });
      console.log(JSON.stringify({id, nodes, baseline:results[0], reserve:results[1]}));
    }
  }
} finally {
  for (const engine of engines) engine.dispose();
}
