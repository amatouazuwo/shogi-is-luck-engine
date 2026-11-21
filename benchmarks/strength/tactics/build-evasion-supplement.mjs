import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { gameRules, info, point, position, representable, seedRng, legal, fromSquare } from './rules.mjs';

const random=seedRng(0x17a670c);
const chosen=items=>items[Math.floor(items.length*random())];
const cells=Array.from({length:81},(_,i)=>i);
const distance=(x,y)=>Math.max(Math.abs((x/9|0)-(y/9|0)),Math.abs(x%9-y%9));
function create(kind,side){
  const board=Array(81).fill(null);
  const defending=chosen(cells.filter(cell=>side===0?cell>44:cell<36));
  const near=cells.filter(i=>distance(i,defending)<=3);
  const centers=near.filter(i=>gameRules.isInnerHole(i)&&i!==defending&&
    (kind==='pit'||!gameRules.boardHoles(i).includes(defending)));
  if(!centers.length)return null;
  const center=chosen(centers);
  const holes=kind==='pit'?[center]:gameRules.boardHoles(center);
  const place=(type,owner,areas)=>{
    const allowed=areas.filter(i=>!board[i]&&!holes.includes(i));
    if(allowed.length)board[chosen(allowed)]=gameRules.piece(type,owner,false);
  };
  board[defending]=gameRules.piece('K',side);
  place('K',1-side,cells.filter(i=>distance(i,defending)>=3));
  for(const type of ['R','B','G','S','N']){
    const nearAttack=near.filter(i=>{
      const rank=(i/9)|0;
      return type!=='N'||(side===1?rank>=2:rank<=6);
    });
    place(type,1-side,nearAttack);
  }
  place(chosen(['B','G','S']),side,near);
  if(random()<.5)place(chosen(['G','S']),side,near);
  return position(board,side,holes,[{},{}],42);
}
const instances=[];
for(const kind of ['pit','blackhole']){
  for(const side of [0,1]){
    const want=4;
    let checked=0, accepted=0;
    for(let i=0;i<8000&&accepted<want;i++){
      const x=create(kind,side);
      if(!x||!representable(x))continue;
      const moves=legal(x);
      if(moves.length<2||moves.length>17)continue;
      const item=info(x,'evade-forced-win');
      if(!item.goodMoves.length||item.goodMoves.length>=item.available.length)continue;
      const mechanisms=new Set(item.goodMoves.map(m=>x.board[fromSquare(m.slice(0,2))]?.type));
      if(mechanisms.size===1&&mechanisms.has('K')&&accepted<2)continue;
      if(item.inCheck&&checked>=2||!item.inCheck&&accepted-checked>=2)continue;
      if(item.inCheck)checked++;
      accepted++;
      instances.push({id:[kind,'evade-supplement',side,accepted].join('/'),kind,category:'evade-forced-win',family:'seeded-evasion',side,...item});
    }
    assert.equal(accepted,want,kind+' '+side+' won '+accepted);
    console.error(kind,side,accepted,checked);
  }
}
writeFileSync('evade-supplement.jsonl',instances.map(x=>JSON.stringify(x)).join('\n')+'\n');
