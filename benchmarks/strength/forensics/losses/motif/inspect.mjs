import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gameRules, legal, play, positionFromSfen, square, winsInOne } from '../../../tactics/rules.mjs';
const { toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const records=readFileSync('replay-100-pit.jsonl','utf8').trim().split('\n').map(JSON.parse);
const reconstruct = ({sfen,holes},clear=false) => positionFromSfen(sfen,clear?[]:holes);
const after = (pos,label) => {
  const found=legal(pos).find(m=>toUsi(m)===label);
  return found ? play(pos,found) : null;
};
function boardText(p) {
  return p.board.flatMap((piece,index) => piece ? [[square(index),`${piece.side?'w':'b'}${piece.pr?'+':''}${piece.type}`]] : []);
}
const first=records[0];
const second=records[1];
const firstRecaptures=legal(reconstruct(first.sfenAfter)).filter(m=>square(m.to)==='2h').map(toUsi);
const house=records[15];
const last=records.at(-1);
console.log(JSON.stringify({beforeFirst:first.sfenBefore,firstCapture:first.capture,possibleImmediateRecaptures:firstRecaptures,
  before16:house.sfenBefore,whiteAt16:boardText(reconstruct(house.sfenBefore)).filter(([_,p])=>p[0]==='w'),
  beforeFinal:last.sfenBefore,afterFinal:last.sfenAfter}));
const checkPositions=[17,19,21].map(n=>records[n-1]);
for(const row of checkPositions) {
  const without=reconstruct(row.sfenAfter,true);
  console.log(JSON.stringify({move:row.move,bestmove:row.bestmove,
    checkWithHole:row.sfenAfter.check,replyWithHole:legal(reconstruct(row.sfenAfter)).map(toUsi),
    checkWithoutHole:gameRules.inCheck(without,without.turn),replyWithoutHole:legal(without).map(toUsi)}));
}
const p=reconstruct(house.sfenBefore);
for(const m of legal(p)) {
  const g=after(play(p,m),'G*5c');
  if (!g) {
    console.log(JSON.stringify({alt:toUsi(m),motif:'G*5c illegal'}));
    continue;
  }
  const escapes = legal(g).map(toUsi);
  if(!escapes.includes('6b7b') || escapes.length !== 1) {
    console.log(JSON.stringify({alt:toUsi(m),motif:'G*5c legal but replies differ',escapes}));
    continue;
  }
  const h=after(after(g,'6b7b'),'1b4e');
  if(!h) console.log(JSON.stringify({alt:toUsi(m),motif:'1b4e illegal'}));
  else if(legal(h).length!==1 || toUsi(legal(h)[0])!=='7d6c') {
    console.log(JSON.stringify({alt:toUsi(m),motif:'1b4e replies differ',escapes:legal(h).map(toUsi)}));
  } else {
    const q=after(after(h,'7d6c'),'4e6c');
    if(!q || legal(q).length)console.log(JSON.stringify({alt:toUsi(m),motif:'4e6c illegal or nonterminal',escapes:q?legal(q).map(toUsi):[]}));
  }
}
const cases=[2,4,6,8,12,14,16,18,20].map(n=>records[n-1]);
const search=spawnSync('../../../reference/obstacle-reference-v1',[],{cwd:process.cwd(),encoding:'utf8',input:cases.map(row=>['go',300,row.sfenBefore.sfen,row.sfenBefore.holes.join(',')].join('\t')).join('\n')+'\n'});
assert.equal(search.status,0,search.stderr);
for(const [i,line] of search.stdout.trim().split('\n').entries()) console.log(JSON.stringify({nativeFor:cases[i].move,logged:cases[i].bestmove,...JSON.parse(line)}));
