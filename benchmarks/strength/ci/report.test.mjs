import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const reportScript = resolve('benchmarks/strength/ci/report.mjs');
const mkGame = (candidateSide, winner, reason) => ({
  event: 'game', kind: 'obstacle', pair: 0, candidateSide, winner, reason,
  turns: [{engine: 'candidate', elapsed: 90, requestMs: 100, depth: 3, nodes: 12}]
});
function run(games) {
  const cwd = mkdtempSync(join(tmpdir(), 'strength-report-'));
  try {
    const input = join(cwd, 'games.jsonl');
    writeFileSync(input, [
      {event: 'config', pairs: 1},
      ...games
    ].map(x => JSON.stringify(x)).join('\n') + '\n');
    const result = spawnSync(process.execPath, [reportScript, input], {
      cwd, encoding: 'utf8', env: {...process.env, GITHUB_STEP_SUMMARY: ''}
    });
    const scorecard = result.status === 0
      ? JSON.parse(readFileSync(join(cwd, 'results/scorecard.json'), 'utf8'))
      : null;
    return {result, scorecard};
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
}
test('unfinished game is a bounded unknown outcome, never a draw', () => {
  const {result, scorecard} = run([
    mkGame(0, 0, 'no-legal'),
    mkGame(1, null, 'ply-cap')
  ]);
  assert.equal(result.status, 0, result.stderr);
  const group = scorecard.reports[0].byKind[0];
  assert.deepEqual(group.scoreBoundsPct, [50, 100]);
  assert.equal(group.win, 1);
  assert.equal(group.draw, 0);
  assert.equal(group.unfinished, 1);
  assert.equal(group.pairDirections.unresolved, 1);
  assert.equal(group.assessment, 'INSUFFICIENT_SAMPLE_OR_UNFINISHED');
});
test('adjudicated repetition draws count as half a point', () => {
  const {result, scorecard} = run([
    mkGame(0, null, 'repetition'),
    mkGame(1, 0, 'no-legal')
  ]);
  assert.equal(result.status, 0, result.stderr);
  const group = scorecard.reports[0].byKind[0];
  assert.deepEqual(group.scoreBoundsPct, [25, 25]);
  assert.equal(group.draw, 1);
  assert.equal(group.loss, 1);
  assert.equal(group.unfinished, 0);
  assert.equal(group.pairDirections.negative, 1);
});
test('duplicate colors cannot silently distort the paired result', () => {
  const {result} = run([
    mkGame(0, 0, 'no-legal'),
    mkGame(0, 0, 'no-legal')
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate pair\/color/);
});
test('unknown winners fail rather than producing a score', () => {
  const {result} = run([
    mkGame(0, 2, 'no-legal'),
    mkGame(1, 0, 'no-legal')
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown winner/);
});
