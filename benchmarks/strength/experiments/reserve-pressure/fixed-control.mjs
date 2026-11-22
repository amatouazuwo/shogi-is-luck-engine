import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [baselineDirectory, candidateDirectory, puzzleFile, ...normalLogs] = process.argv.slice(2);
assert.ok(baselineDirectory && candidateDirectory && puzzleFile && normalLogs.length,
  'node fixed-control.mjs BASELINE_SDK CANDIDATE_SDK OBSTACLE_CORPUS NORMAL_MATCH_LOG...');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const log = (event, fields) => console.log(JSON.stringify({event, ...fields}));
function readJsonl(file){
  return readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
}
function request(engine, command, params = {}){
  const response = engine.request({command, ...params});
  assert.ok(response.ok, command + ': ' + response.error);
  return response.result ?? response;
}
async function engineFrom(directory){
  const {MiniEngine} = await import(pathToFileURL(resolve(directory, 'mini.js')));
  const wasm = readFileSync(resolve(directory, 'rsshogi_nnue_mini.wasm'));
  const engine = await MiniEngine.create(wasm);
  request(engine, 'load_embedded');
  request(engine, 'configure', {hash_mb:16, threads:1});
  return {engine, sha:sha256(wasm)};
}
function position(engine, sfen, holes){
  request(engine, 'new_game');
  request(engine, 'set_obstacle_position', {sfen, holes});
}
function fixedSearch(engine, nodes){
  const {bestmove, score, pv, nodes:visited, depth} = request(engine, 'search', {depth:64, nodes});
  return {bestmove, score, pv, nodes:visited, depth};
}

const before = await engineFrom(baselineDirectory);
const after = await engineFrom(candidateDirectory);
const puzzles = readJsonl(puzzleFile).filter(row => row.id && row.sfen && row.holes?.length);
const normal = new Set(normalLogs.flatMap(file => readJsonl(file)
  .filter(row => row.event === 'game' && row.opening)
  .map(row => row.opening)));
assert.ok(normal.size >= 8 && puzzles.length > 0);
try {
  log('config', {baselineSha256:before.sha, candidateSha256:after.sha, node:process.version,
    puzzleSha256:sha256(readFileSync(puzzleFile)), normalLogs:normalLogs.map(file => sha256(readFileSync(file)))});
  for(const [index, sfen] of [...normal].slice(0,8).entries()){
    for(const nodes of [1000, 5000]){
      position(before.engine, sfen, []);
      position(after.engine, sfen, []);
      const original = fixedSearch(before.engine, nodes);
      const candidate = fixedSearch(after.engine, nodes);
      assert.deepEqual(candidate, original, 'normal ' + index + ' at ' + nodes + ' nodes');
      log('normal', {index, sfen, nodes, result:candidate});
    }
  }
  let nonzero = 0;
  let maximum = 0;
  let legalMoves = 0;
  for(const {id, sfen, holes} of puzzles){
    position(before.engine, sfen, holes);
    position(after.engine, sfen, holes);
    const original = request(before.engine, 'evaluate').score;
    const candidate = request(after.engine, 'evaluate').score;
    const legal = request(before.engine, 'legal_moves').sort();
    assert.deepEqual(request(after.engine, 'legal_moves').sort(), legal, id);
    legalMoves += legal.length;
    const correction = candidate - original;
    assert.ok(Math.abs(correction) <= 80, id + ' exceeds evaluation bound');
    maximum = Math.max(Math.abs(correction), maximum);
    if(correction !== 0) nonzero++;
    log('obstacle-static', {id, sfen, holes, baseline:original, candidate, correction, legal:legal.length});
  }
  log('summary', {obstacleRoots:puzzles.length, nonzero, maximum, legalMoves,
    exactNormalSearches:16, normalPositions:8});
} finally {
  before.engine.dispose();
  after.engine.dispose();
}
