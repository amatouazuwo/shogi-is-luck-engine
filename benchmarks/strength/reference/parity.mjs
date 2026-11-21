import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {gameRules, legal, play, position, positionFromSfen, seedRng, winsInOne} from '../tactics/rules.mjs';
const {toSfen, toObstaclePosition, toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const cases = [];
function samples(label, sfen, holes, checkMate = false) {
  const current = positionFromSfen(sfen, holes);
  const expected = legal(current).map(toUsi).sort();
  const holeString = holes.join(',') || '-';
  cases.push({label, input: ['legal', sfen, holeString], expected: {moves: expected}});
  if (checkMate) {
    const wins = winsInOne(current);
    cases.push({label, input: ['mate', sfen, holeString], expected: {
      mate: wins.filter(win => win.mate).map(win => win.move).sort(),
      noLegalWithoutCheck: wins.filter(win => !win.mate).map(win => win.move).sort(),
    }});
  }
}
for (const [label,sfen,holes] of [
  ['pawn drop mate','4k4/9/4G4/9/9/9/9/9/8K b P 1',['4a','6a','4b','6b']],
  ['checking and quiet no-legal loss','4k4/9/4G4/4R4/9/9/9/9/8K b - 1',['4a','6a','4b','6b']],
  ['blocked sliders and knight','k8/9/9/9/9/9/1B2R1NL1/9/4K4 b G 1',['5e','6f','2f','3f','4e']],
  ['forced promotions and nifu','k8/7P1/9/2N6/9/9/9/9/8K b PNL 1',['4e']],
  ['king escape and interpose','k3r4/9/9/9/9/9/9/9/4K4 b G 1',['3e']],
  ['pin ends at obstacle','k3r4/9/9/9/9/9/4G4/9/4K4 b - 1',['5e']],
]) samples(label,sfen,holes,true);
for (const kind of ['normal','pit','blackhole']) {
  for (let seed=0; seed<16; seed++) {
    const random=seedRng(317581+seed);
    const originalRandom=Math.random;
    let current;
    // The game's rule closure inherits Math.random. Fix the seed for its setup too.
    try {
      Math.random=random;
      current=position(gameRules.independentBoard(),0,[]);
    } finally {
      Math.random=originalRandom;
    }
    for(let ply=0;ply<52;ply++) {
      if (ply===9 && kind!=='normal') {
        const centers=[];
        for (let i=0;i<81;i++) if (gameRules.isInnerHole(i) && !current.board[i]) centers.push(i);
        if (!centers.length) break;
        const center=centers[Math.floor(random()*centers.length)];
        const obstacles=kind==='blackhole'?gameRules.boardHoles(center):[center];
        if(obstacles.some(index=>current.board[index]?.type==='K')) break;
        current={...current, holes: obstacles, board: current.board.map((piece,index)=>obstacles.includes(index)?null:piece)};
      }
      if (ply%4===0) {
        const payload=current.holes.length?toObstaclePosition(current):{sfen:toSfen(current),holes:[]};
        assert.ok(payload);
        samples(`${kind}:${seed}:${ply}`,payload.sfen,payload.holes);
      }
      const choices=legal(current);
      if (!choices.length) break;
      current=play(current,choices[Math.floor(random()*choices.length)]);
    }
  }
}
const reference = spawnSync('./obstacle-reference', [], {encoding:'utf8', maxBuffer:16*1024*1024,
  input:cases.map(item=>item.input.join('\t')).join('\n')+'\n'});
assert.equal(reference.status,0,reference.stderr);
const replies=reference.stdout.trim().split('\n');
assert.equal(replies.length,cases.length);
let positions=0, legalMoves=0, mateChecks=0, mismatches=0;
for (const [index,item] of cases.entries()) {
  const actual=JSON.parse(replies[index]);
  for(const values of Object.values(actual)) if(Array.isArray(values)) values.sort();
  if(item.expected.moves){positions++;legalMoves+=item.expected.moves.length;}else mateChecks++;
  if(JSON.stringify(actual)!==JSON.stringify(item.expected)) {
    mismatches++;
    const differences=Object.keys(item.expected).map(key=>({key,
      onlyGame:item.expected[key].filter(move=>!actual[key]?.includes(move)),
      onlyReference:actual[key]?.filter(move=>!item.expected[key].includes(move))}));
    console.log(JSON.stringify({label:item.label,input:item.input,differences}));
  }
}
console.log(JSON.stringify({positions,legalMoves,mateChecks,mismatches}));
if(mismatches)process.exitCode=1;
