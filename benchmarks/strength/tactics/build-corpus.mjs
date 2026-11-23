import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { info, gameRules, point, position, representable, seedRng, winsInOne } from './rules.mjs';

const count=Number(process.argv[2]||10);
const seed=0x619787;
const random=seedRng(seed);
const chosen=(values)=>values[Math.floor(random()*values.length)];
const piece=(name,side)=>gameRules.piece(name,side,false);
const rows=Array.from({length:81},(_,n)=>n);
const inner=rows.filter(gameRules.isInnerHole);
function orient(x,index){
  const mirror=index%2===1, reverse=index>=2;
  const map=i=>{
    const row=(i/9)|0,col=i%9;
    if(reverse)return point(8-row,mirror?col:8-col);
    return point(row,mirror?8-col:col);
  };
  const board=Array(81).fill(null);
  for(const [i,p] of x.board.entries()){
    if(p)board[map(i)]={...p,side:reverse?1-p.side:p.side};
  }
  return position(board,reverse?1-x.turn:x.turn,x.holes.map(map).sort((a,b)=>a-b),reverse?x.hands.slice().reverse():x.hands,x.steps);
}

const pitTemplate=[
  [[2,2,'N'],[3,1,'N']],
  [[2,0,'N'],[3,1,'N']],
  [[1,2,'S'],[2,0,'P']],
  [[2,2,'N'],[2,1,'B']],
  [[1,2,'B'],[2,0,'P']],
  [[2,0,'P'],[2,2,'N']],
];
const blackholeTemplate=[
  [[2,0,'P']],
  [[3,1,'N']],
  [[2,0,'S']],
  [[2,0,'G']],
];
const names=['mate-in-one','evade-forced-win','material-gain','ray-blocking','no-legal-loss'];
function corner(kind,n,category) {
  const board=Array(81).fill(null);
  board[0]=piece('K',1);
  const holes=kind==='pit'?[10]:gameRules.boardHoles(11);
  const opts=kind==='pit'?pitTemplate:blackholeTemplate;
  const template=opts[n%opts.length];
  const mode=Math.floor(n/opts.length);
  const rotation=mode%4;
  const group=Math.floor(mode/4);
  board[[75,76,77,72,79,65,67][group%7]]=piece('K',0);
  for(const [row,col,type] of template)board[point(row,col)]=piece(type,0);
  const hands=[{},{}];
  let turn=1;
  if(category==='mate-in-one'||category==='evade-forced-win'){
    hands[0][['R','L','B','G','S'][group%5]]=1;
    if(category==='mate-in-one'){
      turn=0;
      const [row,col]=template[(group+rotation)%template.length];
      board[point(row,col)]=null;
    }
    if(category==='evade-forced-win'){
      const [row,col,type]=template[(group+rotation)%template.length];
      board[point(row,col)]=null;
      const displaced=point(row+1,col);
      if(!board[displaced]&&!holes.includes(displaced))board[displaced]=piece(type,0);
      const lures=[58,59,57,68,61,62,66];
      board[lures[group%lures.length]]=piece('P',1);
    }
  }
  return {position:orient(position(board,turn,holes,hands,21+n%17),rotation),family:kind+'-corner-'+n%opts.length};
}
function sparse(kind,n){
  const board=Array(81).fill(null);
  const at=chosen(inner);
  const holes=kind==='pit'?[at]:gameRules.boardHoles(at);
  const empties=rows.filter(i=>!holes.includes(i));
  const place=(type,side,require=()=>true)=>{
    const allowed=empties.filter(i=>!board[i]&&require(i));
    if(allowed.length)board[chosen(allowed)]=piece(type,side);
  };
  place('K',0,i=>i>=45);
  place('K',1,i=>i<36);
  for(const side of [0,1]){
    for(const t of ['R','B','L','N','S','G','P','P']){
      place(t,side,i=>{
        const homeRank=(i/9)|0;
        if(t==='L'||t==='P')return side===0?homeRank>0:homeRank<8;
        if(t==='N')return side===0?homeRank>1:homeRank<7;
        return true;
      });
    }
  }
  return {position:position(board,n%2,holes,[{},{}],24+n%97),family:'seeded-sparse'};
}
const rayTemplate=[
  {name:'rook',ray:[4,0,'R'],victim:[4,8,'R'],at:[4,4],second:[7,3],secondary:[5,2],kings:[8,1,0,7]},
  {name:'bishop',ray:[7,0,'B'],victim:[1,6,'R'],at:[4,3],second:[7,6],secondary:[5,7],kings:[8,1,0,8]},
  {name:'lance',ray:[7,2,'L'],victim:[1,2,'R'],at:[4,2],second:[7,5],secondary:[5,6],kings:[8,5,0,7]},
];
function ray(kind,n){
  const motif=rayTemplate[n%3], rotation=(n/3|0)%4, variant=(n/12|0)%3;
  const board=Array(81).fill(null);
  const put=([r,c,t],side)=>{board[point(r,c)]=piece(t,side);};
  put([...motif.kings.slice(0,2),'K'],0);
  put([...motif.kings.slice(2),'K'],1);
  put(motif.ray,0);
  put(motif.victim,1);
  put([...motif.second,'N'],0);
  put([...motif.secondary,['G','S','B'][variant]],1);
  const at=point(...motif.at);
  const holes=kind==='pit'?[at]:gameRules.boardHoles(at);
  return {position:orient(position(board,0,holes,[{},{}],61+n%11),rotation),family:'blocked-'+motif.name};
}
function plausible(x,category){
  if(!representable(x))return false;
  const moves=gameRules.getLegal(x,x.turn);
  if(category==='no-legal-loss')return !moves.length&&!gameRules.inCheck(x,x.turn);
  if(category==='evade-forced-win'){
    if(moves.length<2||moves.length>11)return false;
    const waiting={...x,turn:1-x.turn};
    return representable(waiting)&&winsInOne(waiting,{stopAfterOne:true}).length>0;
  }
  if(category==='mate-in-one')return moves.length>=4;
  if(category==='ray-blocking')return moves.some(m=>x.board[m.to]);
  return moves.length>=6&&moves.some(m=>x.board[m.to]&&['R','B','G','S','N'].includes(x.board[m.to].type));
}
const entries=[];
for(const kind of ['pit','blackhole']){
  for(const category of names){
    const categoryCases=[];
    const seen=new Set();
    const goal=[Math.floor(count/2),Math.ceil(count/2)];
    const achieved=[0,0];
    for(let i=0;categoryCases.length<count&&i<6000;i++){
      const candidate=category==='ray-blocking'?ray(kind,i):category==='material-gain'?sparse(kind,i):corner(kind,i,category);
      const x=candidate.position;
      if(achieved[x.turn]>=goal[x.turn]||!plausible(x,category))continue;
      const probe=info(x,category);
      if(!probe.goodMoves.length)continue;
      if(category==='evade-forced-win'&&probe.goodMoves.length===probe.available.length)continue;
      if(category==='mate-in-one'&&(probe.goodMoves.length>10||probe.available.length<2*probe.goodMoves.length))continue;
      const key=probe.sfen.split(' ').slice(0,3).join(' ')+' '+probe.holes.join(',');
      if(seen.has(key))continue;
      seen.add(key);
      achieved[x.turn]++;
      const id=[kind,category,String(categoryCases.length+1).padStart(2,'0')].join('/');
      categoryCases.push({id,kind,category,family:candidate.family,side:x.turn,...probe});
    }
    console.error(kind,category,categoryCases.length,achieved);
    assert.equal(categoryCases.length,count,'Insufficient cases for '+kind+' '+category);
    entries.push(...categoryCases);
  }
}
writeFileSync(new URL('corpus.jsonl',import.meta.url),entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
writeFileSync(new URL('corpus-metadata.json',import.meta.url),JSON.stringify({
  seed,cases:entries.length,categories:names,perCategoryAndHazard:count,
  note:'Exact game-rule enumeration generated labels before running either search engine. Hole layouts are a single interior pit or an exact 3×3 zone. Many sparse endgame motifs are color/geometry transformations; this is a tactical corpus, not a sample of human-game frequency.',
},null,2)+'\n');
