import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gameRules, legal, position, positionFromSfen, representable, seedRng, square } from '../../tactics/rules.mjs';
import { pathToFileURL as fileUrl } from 'node:url';
import { resolve as pathResolve } from 'node:path';
const gameRepo = process.env.GAME_REPO || pathResolve(new URL('../../../../../shogi-is-luck', import.meta.url).pathname);
const { toSfen, toUsi } = await import(fileUrl(pathResolve(gameRepo, 'ai/rsshogi-position.mjs')));

const here=dirname(fileURLToPath(import.meta.url));
const phase=process.argv[2]||'attack';
assert.ok(['attack','escape','recheck'].includes(phase));
const seed=phase==='attack'?0x83e27c6:0x9624651;
const random=seedRng(seed);
const totalByKindAndDepth=Number(process.env.HELDOUT_QUOTA||4);
const attemptLimit=Number(process.env.HELDOUT_ATTEMPTS||18000);
const solverPath=process.env.HELDOUT_SOLVER||resolve(here,'solve');
const hazardKinds=['pit','blackhole'];
const moveHorizons=[3,5,7];
const cells=Array.from({length:81},(_,i)=>i);
const within=(a,b)=>Math.max(Math.abs((a/9|0)-(b/9|0)),Math.abs(a%9-b%9));
const choose=domain=>domain[Math.floor(random()*domain.length)];
const valid=(type,owner,i)=>{
  const progress=owner===0?(i/9|0):(8-(i/9|0));
  if(type==='P'||type==='L')return progress>=1;
  return type!=='N'||progress>=2;
};
const families=[
  {id:'center-pocket',region:i=>(i/9|0)>=2&&(i/9|0)<=6&&i%9>=2&&i%9<=6,pieces:['R','B','G','S']},
  {id:'edge-squeeze',region:i=>((i/9|0)===0||(i/9|0)===8)&&i%9>=2&&i%9<=6,pieces:['R','G','N','L']},
  {id:'file-corridor',region:i=>(i%9<=1||i%9>=7)&&(i/9|0)>=2&&(i/9|0)<=6,pieces:['B','G','S','L']},
  {id:'open-cross',region:i=>(i/9|0)>=1&&(i/9|0)<=7&&i%9>=1&&i%9<=7,pieces:['R','B','N','P']},
];
const old=new Set();
const identity=p=>[...p.sfen.split(' ').slice(0,3),p.holes.slice().sort().join(',')].join(' ');
const loadEntries=path=>readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
for(const name of ['corpus.jsonl','mate-three-corpus.jsonl','evade-supplement.jsonl']){
  for(const p of loadEntries(resolve(here,'../../tactics',name)))old.add(identity(p));
}
const processSolver=spawn(solverPath,[],{stdio:['pipe','pipe','inherit']});
const pipe=createInterface({input:processSolver.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
async function ask(command,p,depth){
  processSolver.stdin.write([command,p.sfen,p.holes.join(','),depth].join('\t')+'\n');
  const next=await pipe.next();
  if(next.done)throw Error('C++ solver closed');
  return JSON.parse(next.value);
}
function decorate(x,kind,family){
  return {sfen:toSfen(x,{allowHoles:true}),holes:x.holes.map(square),kind,family,side:x.turn};
}
function available(x){return legal(x).map(toUsi).sort();}
function makeAttack(kind,side,family){
  const board=Array(81).fill(null);
  const defender=1-side;
  const enemyKing=choose(cells.filter(family.region));
  const nearby=cells.filter(i=>within(i,enemyKing)<=3);
  const centers=nearby.filter(i=>gameRules.isInnerHole(i)&&i!==enemyKing&&
    (kind==='pit'||!gameRules.boardHoles(i).includes(enemyKing)));
  if(!centers.length)return null;
  const center=choose(centers);
  const holes=kind==='pit'?[center]:gameRules.boardHoles(center);
  const used={};
  const put=(type,owner,candidates)=>{
    const vacant=candidates.filter(i=>!board[i]&&!holes.includes(i)&&valid(type,owner,i));
    if(!vacant.length)return false;
    board[choose(vacant)]=gameRules.piece(type,owner,false);
    used[type]=(used[type]||0)+1;
    return true;
  };
  board[enemyKing]=gameRules.piece('K',defender,false);
  if(!put('K',side,cells.filter(i=>within(i,enemyKing)>=3)))return null;
  const attackers=family.pieces.filter(()=>random()<.86);
  for(const type of attackers){
    put(type,side,nearby.filter(i=>within(i,enemyKing)>=1));
  }
  if(attackers.length<2)return null;
  if(random()<.62)put(choose(['G','S','L','N','P']),defender,nearby);
  if(random()<.27)put(choose(['S','P']),defender,nearby);
  const hands=[{},{}];
  if(random()<.3){
    const unit=choose(['R','B','G','S','L','N']);
    if((used[unit]||0)<2)hands[side][unit]=1;
  }
  const x=position(board,side,holes,32);
  return {...x,hands};
}
function verifyRoot(x,p,proof){
  assert.deepEqual(proof.available.slice().sort(),available(x),p.sfen);
  assert.ok(proof.goodMoves.length&&proof.goodMoves.every(m=>proof.available.includes(m)),p.sfen);
}
function record(p,proof,id){
  return {...p,id,horizon:proof.depth,category:proof.kind==='attack'?'forced-win-'+proof.depth:'forced-loss-escape-'+proof.depth,
    available:proof.available.sort(),goodMoves:proof.goodMoves.sort(),proof};
}
function writePortable(filename,records,info){
  const path=resolve(here,filename);
  const body=records.map(p=>JSON.stringify(p)).join('\n')+'\n';
  if(existsSync(path))throw Error('Refusing to overwrite frozen '+filename);
  writeFileSync(path,body,{flag:'wx'});
  const sha256=createHash('sha256').update(body).digest('hex');
  const report={seed,file:filename,sha256,records:records.length,...info};
  writeFileSync(path+'.metadata.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'frozen',...report}));
}
async function attack(){
  const records=[];
  const counts=new Map();
  const seen=new Set(old);
  const search={submitted:0,fastFound:0,fastLimit:0,fullLimit:0};
  const progress=resolve(here,'attack-progress.jsonl');
  const byKindDepth=(kind,depth)=>records.filter(r=>r.kind===kind&&r.horizon===depth);
  const full=()=>hazardKinds.every(kind=>moveHorizons.every(depth=>byKindDepth(kind,depth).length>=totalByKindAndDepth));
  for(let i=0;i<attemptLimit&&!full();i++){
    const kind=hazardKinds[i%2];
    const side=(i/2|0)%2;
    const family=families[(i/4|0)%families.length];
    const x=makeAttack(kind,side,family);
    if(!x||!representable(x)||gameRules.inCheck(x,x.turn))continue;
    const p=decorate(x,kind,family.id);
    if(seen.has(identity(p)))continue;
    search.submitted++;
    const candidate=await ask('sample',p,7);
    if(candidate.status==='limit')search.fastLimit++;
    if(candidate.status!=='found')continue;
    search.fastFound++;
    if(byKindDepth(kind,candidate.depth).length>=totalByKindAndDepth)continue;
    const verified=await ask('attack',p,candidate.depth);
    if(verified.status==='limit')search.fullLimit++;
    if(verified.status!=='ok'||verified.depth<3)continue;
    const peers=byKindDepth(kind,verified.depth);
    const count=peers.length;
    if(count>=totalByKindAndDepth)continue;
    if(peers.filter(r=>r.side===side).length>=Math.ceil(totalByKindAndDepth/2))continue;
    if(peers.filter(r=>r.family===family.id).length>=Math.ceil(totalByKindAndDepth/2))continue;
    if(verified.goodMoves.length>Math.max(3,Math.floor(verified.available.length/3)))continue;
    verifyRoot(x,p,verified);
    seen.add(identity(p));
    const id=['heldout',kind,'win'+verified.depth,String(count+1).padStart(2,'0')].join('/');
    const row=record(p,verified,id);
    records.push(row);
    counts.set(kind+'/'+verified.depth,count+1);
    appendFileSync(progress,JSON.stringify(row)+'\n');
    console.log(JSON.stringify({event:'accepted',i,id,side,family:family.id,good:verified.goodMoves.length,
      legal:verified.available.length,nodes:verified.nodes,counts:Object.fromEntries(counts),search}));
  }
  assert.ok(records.length>=12,'Not enough independently verified positions to freeze');
  const sorted=records.sort((a,b)=>a.id.localeCompare(b.id));
  writePortable('heldout-attack.jsonl',sorted,{search,strata:Object.fromEntries(counts),
    objective:'Force opponent to have no legal move in the shortest checked horizon, through every opposing response. All first moves are enumerated. Captures and positional scores do not affect labels.',
    leaf:'Full-width independent C++ shogi/obstacle rules; every root legal set verified with game getLegal.'});
}

function predecessor(current,anchor,from,to){
  const board=current.board.slice();
  board[from]=board[to];
  board[to]=null;
  return position(board,1-current.turn,current.holes,current.hands,current.steps-1);
}
async function escape(){
  const source=loadEntries(resolve(here,'heldout-attack.jsonl'));
  const records=[];
  const seen=new Set([...old,...source.map(identity)]);
  const search={submitted:0,limit:0};
  const progress=resolve(here,'escape-progress.jsonl');
  const quota=2;
  const byGroup=(kind,horizon)=>records.filter(r=>r.kind===kind&&r.horizon===horizon);
  for(const item of source){
    if(byGroup(item.kind,item.horizon).length>=quota)continue;
    const x=positionFromSfen(item.sfen,item.holes);
    const defender=1-x.turn;
    const king=x.board.findIndex(p=>p?.type==='K'&&p.side===defender);
    const nearby=cells.filter(i=>within(i,king)<=3);
    const movedPieces=x.board.map((p,i)=>p?.side===defender?i:-1).filter(i=>i>=0);
    for(const to of movedPieces){
      if(byGroup(item.kind,item.horizon).length>=quota)break;
      const cellOptions=nearby.filter(from=>from!==to&&!x.board[from]&&!x.holes.includes(from));
      for(const from of cellOptions){
        if(byGroup(item.kind,item.horizon).length>=quota)break;
        const before=predecessor(x,item,from,to);
        if(!representable(before))continue;
        const roots=legal(before);
        if(roots.length<2||roots.length>20||!roots.some(m=>!m.drop&&!m.promote&&m.from===from&&m.to===to))continue;
        const p=decorate(before,item.kind,item.family+'-predecessor');
        if(seen.has(identity(p)))continue;
        seen.add(identity(p));
        search.submitted++;
        const verified=await ask('escape',p,item.horizon);
        if(verified.status==='limit')search.limit++;
        if(verified.status!=='ok')continue;
        verifyRoot(before,p,verified);
        const id=['heldout',item.kind,'escape'+item.horizon,byGroup(item.kind,item.horizon).length+1].join('/');
        const row={...record(p,verified,id),pairedAttack:item.id};
        records.push(row);
        appendFileSync(progress,JSON.stringify(row)+'\n');
        console.log(JSON.stringify({event:'accepted',id,anchor:item.id,side:p.side,good:verified.goodMoves.length,legal:verified.available.length,nodes:verified.nodes}));
        break;
      }
    }
  }
  assert.ok(records.length>=4,'Insufficient defensive puzzles');
  writePortable('heldout-escape.jsonl',records.sort((a,b)=>a.id.localeCompare(b.id)),{search,
    strata:Object.fromEntries(hazardKinds.flatMap(kind=>moveHorizons.map(depth=>[kind+'/'+depth,byGroup(kind,depth).length]))),
    objective:'Choose a move that prevents the opponent from forcing a no-legal-move win in the configured following horizon. All first moves are enumerated.',
    relation:'Some defensive starting positions precede a held-out attack position. The two fixtures are reported as separate strata.',
    leaf:'Full-width independent C++ shogi/obstacle rules; every root legal set verified with game getLegal.'});
}

async function recheck(){
  const source=[...loadEntries(resolve(here,'heldout-attack.jsonl'))];
  const defense=resolve(here,'heldout-escape.jsonl');
  if(existsSync(defense))source.push(...loadEntries(defense));
  const seen=new Set(old);
  let totalNodes=0;
  for(const p of source){
    assert.ok(!seen.has(identity(p)),p.id);
    seen.add(identity(p));
    const x=positionFromSfen(p.sfen,p.holes);
    const repeated=await ask(p.proof.kind,p,p.horizon);
    assert.equal(repeated.status,'ok',p.id);
    assert.equal(repeated.depth,p.horizon,p.id);
    verifyRoot(x,p,repeated);
    assert.deepEqual(repeated.goodMoves.sort(),p.goodMoves,p.id);
    assert.deepEqual(repeated.lossPliesAfterDefense,p.proof.lossPliesAfterDefense,p.id);
    totalNodes+=repeated.nodes;
  }
  console.log(JSON.stringify({event:'verified',positions:source.length,nodes:totalNodes,oldOverlap:0}));
}
try{
  if(phase==='attack')await attack();
  else if(phase==='escape')await escape();
  else await recheck();
}finally{processSolver.stdin.end();}
