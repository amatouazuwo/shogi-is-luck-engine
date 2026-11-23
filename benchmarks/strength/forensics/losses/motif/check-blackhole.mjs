import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameRules, legal, play, positionFromSfen, winsInOne} from '../../../tactics/rules.mjs';
const {toObstaclePosition, toSfen, toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
const replay=readFileSync('replay-100-blackhole-win.jsonl','utf8').trim().split('\n').map(JSON.parse);
const reconstruct = ({sfen,holes},withHoles=true) => positionFromSfen(sfen,withHoles?holes:[]);
function after(position,usi) {
  const selected=legal(position).find(m=>toUsi(m)===usi);
  return selected ? play(position,selected) : null;
}
for(const withHoles of [true,false]) {
  const p=reconstruct(replay[35].sfenBefore,withHoles);
  const first=after(p,'8f8h+'); assert.ok(first);
  const options=legal(first).map(toUsi);
  const second=options.map(reply=>{
    const w=after(first,reply);
    const check=after(w,'S*8g');
    return {reply, checkLegal:!!check, blackResponses:check?legal(check).map(m=>{
      const last=play(check,m);
      return {move:toUsi(m),mateReplies:winsInOne(last),sf:withHoles?toObstaclePosition(last).sfen:toSfen(last)};
    }):[]};
  });
  console.log(JSON.stringify({withHoles,options,second}));
}
const before35=reconstruct(replay[34].sfenBefore);
for(const alternative of ['R*8g','P*8g','6a7a','7i7h']) {
  const p=after(before35,alternative);
  if(!p) continue;
  console.log(JSON.stringify({alternative,checking:gameRules.inCheck(p,p.turn),oldWhiteMoveLegal:!!after(p,'8f8h+'),candidate:toObstaclePosition(p)}));
}
