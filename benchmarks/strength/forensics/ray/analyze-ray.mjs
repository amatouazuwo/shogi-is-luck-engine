import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { toSfen, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
const { MiniEngine } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/obstacle-sdk/mini.js')));
import { gameRules, legal, play, positionFromSfen } from '../../tactics/rules.mjs';

function read(name) {
  return readFileSync(new URL('../../tactics/' + name, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
}
const trials = read('worker-results.jsonl');
const missed = new Map(trials.filter(t => t.event === 'trial' && t.category === 'ray-blocking' && !t.success)
  .map(t => [t.id, t.move]));
const fixtures = read('corpus.jsonl').filter(fixture => missed.has(fixture.id));
const oracle = new URL('./branch-oracle', import.meta.url).pathname;
const wasm = readFileSync(strengthJoin(strengthGame, 'ai/obstacle-sdk/rsshogi_nnue_mini.wasm'));
const sha = createHash('sha256').update(wasm).digest('hex');
assert.equal(sha, '0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108');
const engine = await MiniEngine.create(wasm);
function ask(command, fields = {}) {
  const answer = engine.request({command, ...fields});
  assert.equal(answer.ok, true, JSON.stringify({command, error: answer.error}));
  return answer;
}
function set(sfen, holes) {
  ask('new_game');
  if (holes.length) ask('set_obstacle_position', {sfen, holes});
  else ask('set_position', {sfen});
}
function search(sfen, holes, depth) {
  set(sfen, holes);
  const {result} = ask('search', {depth, nodes: 1_000_000});
  assert.ok(result);
  return result;
}
function score(sfen, holes) {
  set(sfen, holes);
  return ask('evaluate').score;
}
function humanBranch(position, move) {
  const root = legal(position).find(candidate => toUsi(candidate) === move);
  assert.ok(root);
  const next = play(position, root);
  return {
    sfen: toSfen(next, {allowHoles: true}),
    isCheck: gameRules.inCheck(next, next.turn),
    replies: legal(next).map(toUsi),
  };
}
function compact(result) {
  const {depth, nodes, score, mate, pv, bestmove} = result;
  return {depth, nodes, score, mate, pv, bestmove};
}

try {
  ask('load_embedded');
  ask('configure', {hash_mb: 16, threads: 1});
  for (const f of fixtures) {
    const bad = missed.get(f.id);
    assert.equal(f.goodMoves.length, 1);
    const target = f.goodMoves[0];
    const position = positionFromSfen(f.sfen, f.holes);
    set(f.sfen, f.holes);
    const maskedLegal = ask('legal_moves').result;
    set(f.sfen, []);
    const clearedLegal = ask('legal_moves').result;
    const branches = [target, bad].map(move => ({move, ...humanBranch(position, move)}));
    const input = branches.map(b => [f.sfen, f.holes.join(','), b.move].join('\t')).join('\n') + '\n';
    const proof = execFileSync(oracle, [], {input, encoding: 'utf8', timeout: 35_000}).trim().split('\n').map(JSON.parse);
    assert.ok(proof.every(result => !result.error));
    const roots = [1, 3, 5, 7, 9].map(depth => ({requested: depth, ...compact(search(f.sfen, f.holes, depth))}));
    const rootAnalysis = {
      mask: score(f.sfen, f.holes),
      cleared: score(f.sfen, []),
      clearedDepth7: compact(search(f.sfen, [], 7)),
    };
    for (const [index, b] of branches.entries()) {
      const expected = proof[index];
      assert.equal(expected.move, b.move);
      assert.equal(expected.enemyReplies, b.replies.length);
      assert.equal(expected.check, b.isCheck);
      b.proof = expected;
      b.rawNnueFromMover = -score(b.sfen, f.holes);
      b.continuations = [2, 4, 6, 8].map(depth => ({requested: depth, ...compact(search(b.sfen, f.holes, depth))}));
    }
    console.log(JSON.stringify({id: f.id, sfen: f.sfen, holes: f.holes, target, bad, blocked: f.blocked,
      maskExcludesBlocked: f.blocked.every(move => !maskedLegal.includes(move)),
      clearAllowsBlocked: f.blocked.every(move => clearedLegal.includes(move)), rootAnalysis, roots, branches}));
  }
} finally {
  engine.dispose();
}
