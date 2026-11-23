import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { toSfen, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
import { gameRules, legal, play, positionFromSfen } from './rules.mjs';

function read(name) {
  return readFileSync(new URL(name, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
}
const fixtures = new Map(read('corpus.jsonl').map(fixture => [fixture.id, fixture]));
const failures = new Map();
for (const trial of read('worker-results.jsonl')) {
  if (trial.event !== 'trial' || trial.success) continue;
  const key = trial.id + ' ' + trial.move;
  if (!failures.has(key)) failures.set(key, {id: trial.id, move: trial.move, budgets: []});
  failures.get(key).budgets.push(trial.budget);
}
const queries = new Map();
const decisions = [];
for (const failure of failures.values()) {
  const {sfen, holes} = fixtures.get(failure.id);
  const position = positionFromSfen(sfen, holes);
  const first = legal(position).find(move => toUsi(move) === failure.move);
  if (!first) continue;
  const after = play(position, first);
  const defenses = legal(after);
  const replies = defenses.map(reply => {
    const x = play(after, reply);
    const query = ['mate', toSfen(x, {allowHoles: true}), holes.join(',')].join('\t');
    queries.set(query, null);
    return [toUsi(reply), query];
  });
  decisions.push({...failure, inCheck: gameRules.inCheck(after, after.turn), replies});
}
const keys = [...queries.keys()];
const results = execFileSync(new URL('../reference/obstacle-reference-v1', import.meta.url).pathname,
  {input: keys.join('\n') + '\n', encoding: 'utf8', timeout: 30000}).trim().split('\n').map(JSON.parse);
for (const [index, key] of keys.entries()) queries.set(key, results[index]);
for (const {replies, ...decision} of decisions) {
  const branchWins = replies.map(([reply, key]) => {
    const {mate, noLegalWithoutCheck} = queries.get(key);
    return {reply, mate, noLegalWithoutCheck};
  });
  const provesWinWithinThree = branchWins.every(branch => branch.mate.length || branch.noLegalWithoutCheck.length);
  console.log(JSON.stringify({...decision, responses: replies.length, provesWinWithinThree,
    ...(provesWinWithinThree ? {branchWins} : {})}));
}
