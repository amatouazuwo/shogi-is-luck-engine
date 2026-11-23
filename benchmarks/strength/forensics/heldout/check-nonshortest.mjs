import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [binary, corpusPath, ...trailPaths] = process.argv.slice(2);
assert.ok(binary && corpusPath && trailPaths.length);
function jsonLines(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
}
const corpus = new Map(jsonLines(corpusPath).map(entry => [entry.id, entry]));
const queries = new Map();
const results = [];
for (const logPath of trailPaths) {
  for (const trial of jsonLines(logPath)) {
    if (trial.event !== 'trial' || !trial.legal) continue;
    const puzzle = corpus.get(trial.id);
    if (!puzzle || !puzzle.category.startsWith('forced-win-') || trial.correct) continue;
    const command = ['branch', puzzle.sfen, puzzle.holes.join(','), 7, trial.move].join('\t');
    queries.set(command, null);
    results.push({logPath, name: trial.name, budget: trial.budget, id: trial.id, move: trial.move, command});
  }
}
const commands = [...queries.keys()];
if (commands.length) {
  const answers = execFileSync(binary, [], {input: commands.join('\n')+'\n', encoding: 'utf8',
    timeout: 120000}).trim().split('\n').map(JSON.parse);
  assert.equal(answers.length, commands.length);
  for (const [index, command] of commands.entries()) queries.set(command, answers[index]);
}
for (const {command, ...result} of results) console.log(JSON.stringify({...result, ...queries.get(command)}));
