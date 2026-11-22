import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, appendFileSync} from 'node:fs';

const inputs = process.argv.slice(2);
assert.ok(inputs.length, 'Pass match JSONL files');
const outcome = g => g.winner === null ? (g.reason === 'repetition' ? 'draw' : 'unresolved') :
  g.winner === g.candidateSide ? 'win' : 'loss';
const list = [];
for (const file of inputs) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const configs = rows.filter(r => r.event === 'config');
  assert.equal(configs.length, 1, 'Expected one config in ' + file);
  const config = configs[0];
  const games = rows.filter(r => r.event === 'game');
  const groups = new Map();
  for (const g of games) {
    assert.ok(Array.isArray(g.turns) && [0, 1].includes(g.candidateSide));
    const key = JSON.stringify([g.kind, g.pair]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const gamesOfPair of groups.values()) {
    assert.equal(gamesOfPair.length, 2, 'Expected exactly two colors per opening');
    const [sente, gote] = [0, 1].map(side => gamesOfPair.find(g => g.candidateSide === side));
    assert.ok(sente && gote, 'Color pair must contain both sides');
    assert.equal(sente.start, gote.start, 'Different starting position in color pair');
    assert.deepEqual(sente.holes, gote.holes, 'Different obstacles in color pair');
    const firstDivergence = sente.turns.findIndex((t, i) => gote.turns[i]?.move !== t.move);
    const divergencePly = firstDivergence === -1
      ? (sente.turns.length === gote.turns.length ? null : Math.min(sente.turns.length, gote.turns.length) + 1)
      : firstDivergence + 1;
    const divergentMoves = divergencePly === null ? null : {
      candidateSente: sente.turns[divergencePly - 1]?.move ?? null,
      candidateGote: gote.turns[divergencePly - 1]?.move ?? null
    };
    const cases = gamesOfPair.filter(g => outcome(g) === 'loss').map(g => {
      const index = g.turns.findLastIndex(t => t.engine === 'candidate');
      return {candidateSide: g.candidateSide, lastCandidatePly: index < 0 ? null : index + 1,
        lastCandidateMove: index < 0 ? null : g.turns[index].move,
        reason: g.reason, plies: g.turns.length};
    });
    const priority = cases.length === 2 ? 'review-both-colors'
      : cases.length === 1 ? 'review-single-loss' : 'no-confirmed-loss';
    list.push({file, kind: sente.kind, pair: sente.pair,
      candidateCommit: process.env.GITHUB_SHA || null,
      candidateWasmSha256: config.candidateSha ?? null,
      baselineWasmSha256: config.baselineSha ?? null,
      opponent: config.opponent, budgetMs: config.budget, fixtureSha256: config.fixtureSha,
      results: {candidateSente: outcome(sente), candidateGote: outcome(gote)},
      divergencePly, divergentMoves, reviewCandidates: cases, priority,
      caveat: 'These are replay entry points, not proven blunders. No position evaluation, causal proof or engine improvement is implied.'});
  }
}
list.sort((a,b) => {
  const rank = {'review-both-colors': 0, 'review-single-loss': 1, 'no-confirmed-loss': 2};
  return rank[a.priority] - rank[b.priority] || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind) || a.pair-b.pair;
});
mkdirSync('results', {recursive: true});
writeFileSync('results/review-queue.json', JSON.stringify({schema:1, entries:list},null,2)+'\n');
const lines = ['## Loss replay review queue',
  'Replay candidates are NOT certified bad moves. Starts are archived and sample sizes small.',
  '| Match file / board / pair | Candidate sente | Candidate gote | First move divergence (ply) | Review priority |',
  '|---|---|---|---:|---|',
  ...list.map(x=>'| '+x.file+' / '+x.kind+' / '+x.pair+' | '+x.results.candidateSente+' | '+x.results.candidateGote+
    ' | '+(x.divergencePly ?? 'none')+' | '+x.priority+' |')];
const md=lines.join('\n')+'\n';
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
