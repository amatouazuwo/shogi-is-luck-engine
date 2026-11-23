import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameRules, legal, play, positionFromSfen, square, winsInOne } from '../../../tactics/rules.mjs';
const { toObstaclePosition, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const [budgetText='100',kind='pit',result='loss'] = process.argv.slice(2);
const rows=readFileSync(new URL('../../../obstacle-reference-midgame.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
const g=rows.find(g=>g.event==='game'&&g.nnueSide===1&&g.budget===Number(budgetText)&&g.kind===kind&&g.winner!==null&&(g.winner===g.nnueSide)===(result==='win'));
assert.ok(g);
let pos=positionFromSfen(g.start.sfen,g.start.holes);
function summarize(position) {
  const kings=position.board.flatMap((piece,index)=>piece?.type==='K'?[{side:piece.side,square:square(index)}]:[]);
  const unit={P:100,L:300,N:350,S:450,G:550,B:825,R:1000,K:0};
  const material=position.board.reduce((a,p)=>a+(p?(p.side?-1:1)*(unit[p.type]+(p.pr?100:0)):0),0)+
    position.hands.reduce((a,hand,side)=>a+(side?-1:1)*Object.entries(hand).reduce((x,[p,n])=>x+unit[p]*n,0),0);
  return {...toObstaclePosition(position),kings,material,check:gameRules.inCheck(position,position.turn),legal:legal(position).length};
}
for(const [i,turn] of g.turns.entries()) {
  const list=legal(pos);
  assert.equal(pos.turn,turn.side);
  const move=list.find(m=>toUsi(m)===turn.bestmove);
  assert.ok(move, JSON.stringify({i,turn,sfen:toObstaclePosition(pos)}));
  const next=play(pos,move);
  const wins=winsInOne(next);
  const safe=turn.side!==g.winner&&wins.length?list.filter(m=>!winsInOne(play(pos,m),{stopAfterOne:true}).length).map(toUsi):[];
  console.log(JSON.stringify({move:i+1,bestmove:turn.bestmove,engine:turn.engine,depth:turn.depth,side:turn.side,sfenBefore:summarize(pos),capture:pos.board[move.to],target:square(move.to),sfenAfter:summarize(next),oppWinsInOne:wins,safe}));
  pos=next;
}
assert.equal(legal(pos).length,0);
