import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { gameRules, legal, play, position, representable, seedRng, square, winsInOne } from './rules.mjs';
const { toSfen, toUsi } = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const random=seedRng(0x1dbd1a7);
const choose=items=>items[Math.floor(random()*items.length)];
const cells=Array.from({length:81},(_,i)=>i);
const distance=(x,y)=>Math.max(Math.abs((x/9|0)-(y/9|0)),Math.abs(x%9-y%9));
const roles={R:2,B:2,G:4,S:4,N:4,L:4};
function candidate(kind,side){
  const board=Array(81).fill(null);
  const defender=1-side;
  const nearCorner=cells.filter(i=>(i%9<=2||i%9>=6)&&(side===0?i<27:i>=54));
  const king=choose(nearCorner);
  const nearby=cells.filter(i=>distance(i,king)<=4);
  const centers=nearby.filter(i=>gameRules.isInnerHole(i)&&i!==king&&
    (kind==='pit'||!gameRules.boardHoles(i).includes(king)));
  if(!centers.length)return null;
  const at=choose(centers),holes=kind==='pit'?[at]:gameRules.boardHoles(at);
  const count={};
  const put=(type,owner,region)=>{
    const free=region.filter(i=>!board[i]&&!holes.includes(i));
    if(!free.length)return;
    board[choose(free)]=gameRules.piece(type,owner,false);
    count[type]=(count[type]||0)+1;
  };
  board[king]=gameRules.piece('K',defender,false);
  const fullRegion=cells.filter(i=>distance(i,king)>=3);
  const kingHome=fullRegion.filter(i=>side===0?i>44:i<36);
  put('K',side,kingHome);
  for(const t of ['R','B','G','S','N','L']){
    if(random()<.17)continue;
    const attackRegion=nearby.filter(i=>{
      const rank=i/9|0;
      if(t==='N')return side===0?rank>=2:rank<=6;
      if(t==='L')return side===0?rank>0:rank<8;
      return true;
    });
    put(t,side,attackRegion);
  }
  if(random()<.5)put(choose(['G','S','B','R']),defender,nearby);
  const hands=[{},{}],available=Object.keys(roles).filter(t=>(count[t]||0)<roles[t]);
  if(random()<.67)hands[side][choose(available)]=1;
  return position(board,side,holes,hands,54);
}
function mateMoves(x,stopAfterOne=false){
  const proof=[];
  for(const move of legal(x)){
    const child=play(x,move);
    if(gameRules.inCheck(child,child.turn)&&!legal(child).length) {
      proof.push(toUsi(move));
      if(stopAfterOne)break;
    }
  }
  return proof.sort();
}
function threePly(x){
  if(winsInOne(x,{stopAfterOne:true}).length)return null;
  const solved={};
  for(const first of legal(x)){
    const child=play(x,first);
    if(!gameRules.inCheck(child,child.turn))continue;
    const defenses=legal(child);
    if(!defenses.length)continue;
    let defendable=false;
    for(const defense of defenses){
      if(!mateMoves(play(child,defense),true).length){defendable=true;break;}
    }
    if(defendable)continue;
    solved[toUsi(first)]=Object.fromEntries(defenses.map(defense=>[toUsi(defense),mateMoves(play(child,defense))]));
  }
  return Object.keys(solved).length?solved:null;
}
const entries=[];
for(const kind of ['pit','blackhole']){
  for(const side of [0,1]){
    const want=3;
    let accepted=0;
    for(let i=0;i<12000&&accepted<want;i++){
      const x=candidate(kind,side);
      if(!x||!representable(x)||gameRules.inCheck(x,x.turn))continue;
      const proof=threePly(x);
      if(!proof||Object.keys(proof).length>3)continue;
      const id=[kind,'mate-in-three',side,++accepted].join('/');
      entries.push({id,kind,category:'mate-in-three',family:'seeded-forcing',side,
        sfen:toSfen(x,{allowHoles:true}),holes:x.holes.map(square),goodMoves:Object.keys(proof).sort(),
        available:legal(x).map(toUsi).sort(),inCheck:false,proof});
    }
    assert.equal(accepted,want,kind+' '+side);
    console.error(kind,side,accepted);
  }
}
writeFileSync('mate-three-corpus.jsonl',entries.map(x=>JSON.stringify(x)).join('\n')+'\n');
