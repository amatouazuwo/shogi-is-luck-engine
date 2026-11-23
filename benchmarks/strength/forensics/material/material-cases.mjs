import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gameRules, legal, pieceUnits, play, positionFromSfen, fromSquare } from '../../tactics/rules.mjs';
const {toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));
const lines=file=>readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
const puzzles=lines('../../tactics/corpus.jsonl').filter(p=>p.category==='material-gain');
const trials=lines('../../tactics/worker-results.jsonl').filter(x=>x.event==='trial');
const result=[];
for(const puzzle of puzzles){
  const runs=trials.filter(t=>t.id===puzzle.id);
  if(runs.every(t=>t.success))continue;
  const p=positionFromSfen(puzzle.sfen,puzzle.holes);
  const initialLegal=legal(p);
  const movesByUsi=new Map(initialLegal.map(m=>[toUsi(m),m]));
  const evaluateMove=usi=>{
    const move=movesByUsi.get(usi);
    if(!move)throw Error(puzzle.id+' illegal '+usi);
    const child=play(p,move);
    const value=pieceUnits[p.board[move.to]?.type]||0;
    const options=legal(child);
    const worst=Math.max(...options.map(m=>pieceUnits[child.board[m.to]?.type]||0),0);
    return {
      move:usi,captured:value,check:gameRules.inCheck(child,child.turn),
      opponentReplies:options.length,
      worstRecapture:worst,labelScore:value-worst,
      worstReplies:options.filter(m=>worst>0&&(pieceUnits[child.board[m.to]?.type]||0)===worst).map(toUsi).sort(),
    };
  };
  result.push({
    ...puzzle,
    trials:runs,
    candidates:[...new Set([...puzzle.goodMoves,...runs.map(t=>t.move)])].map(evaluateMove),
  });
}
assert.equal(result.length,8);
assert.equal(result.reduce((sum,p)=>sum+p.trials.filter(t=>!t.success).length,0),23);
writeFileSync('cases.jsonl',result.map(p=>JSON.stringify(p)).join('\n')+'\n');
for(const p of result)console.log(p.id,JSON.stringify(p.candidates));
