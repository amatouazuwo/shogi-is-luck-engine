import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gameRules, legal, play, position, positionFromSfen, representable, seedRng, square } from '../tactics/rules.mjs';
import { toSfen, toUsi } from './game-context.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const solverPath=process.env.DEFENSE_SOLVER||resolve(here,'../forensics/heldout/solve');
const oracle=spawn(solverPath,[],{stdio:['pipe','pipe','inherit']});
const replies=createInterface({input:oracle.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
const seed=Number(process.env.DEFENSE_SEED||0x3e6870c7);
const rnd=seedRng(seed);
const choose=items=>items[Math.floor(rnd()*items.length)];
const hashes=bytes=>createHash('sha256').update(bytes).digest('hex');
const cells=Array.from({length:81},(_,x)=>x);
const coordinate=i=>[i/9|0,i%9];
const dist=(a,b)=>Math.max(Math.abs((a/9|0)-(b/9|0)),Math.abs(a%9-b%9));
const kinds=['pit','blackhole'];
const horizons=[3,5,7];
const limit=Number(process.env.DEFENSE_ATTEMPTS||16000);
const mode=process.argv[2]||'generate';
const maxRoot=20;
const minPieces=Number(process.env.DEFENSE_MIN_PIECES||8);
const maxPieces=11;
const prior=[
  '../tactics/corpus.jsonl','../tactics/mate-three-corpus.jsonl','../tactics/evade-supplement.jsonl',
  '../forensics/heldout/heldout.jsonl',
];
const readList=name=>readFileSync(resolve(here,name),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const outputName=process.env.DEFENSE_OUTPUT||'unseen-defense.jsonl';

const patterns=[
  {name:'central-pocket', location:([r,c])=>r>1&&r<7&&c>1&&c<7, support:['G','S','N','B']},
  {name:'skew-flank', location:([r,c])=>r>1&&r<7&&(c<2||c>6), support:['N','L','S','G']},
  {name:'camp-line', location:([r,c])=>(r<2||r>6)&&c>0&&c<8, support:['G','S','L','N']},
  {name:'corner-turn', location:([r,c])=>(r<2||r>6)&&(c<2||c>6), support:['S','G','L','B']},
];

const key=(x,hFlip,vFlip)=>{
  const remap=i=>9*(vFlip?8-(i/9|0):(i/9|0))+(hFlip?8-i%9:i%9);
  const board=Array(81).fill(null);
  for(let i=0;i<81;i++)if(x.board[i]){
    board[remap(i)]={...x.board[i],side:vFlip?1-x.board[i].side:x.board[i].side};
  }
  const copy={...x,board,turn:vFlip?1-x.turn:x.turn,hands:vFlip?x.hands.slice().reverse():x.hands};
  return [...toSfen(copy,{allowHoles:true}).split(' ').slice(0,3),x.holes.map(i=>square(remap(i))).sort().join(',')].join(' ');
};
function canonical(x){
  return [key(x,false,false),key(x,true,false),key(x,false,true),key(x,true,true)].sort()[0];
}
const excluded=new Set(prior.flatMap(readList).map(p=>canonical(positionFromSfen(p.sfen,p.holes))));
const priorCount=prior.flatMap(readList).length;
const totals={sampled:0,representable:0,near:0,legal:0,fastProbes:0,fullProbes:0,rejectedCap:0,fastCap:0};
const validSq=(type,side,i,promoted)=>{
  if(promoted)return true;
  const r=i/9|0, forward=side===0?r:8-r;
  return type==='N'?forward>=2:(type!=='L'&&type!=='P')||forward>=1;
};
const pieceCaps={K:2,R:2,B:2,G:4,S:4,N:4,L:4,P:18};

function direct(kind,side,pattern,n){
  const b=Array(81).fill(null), counts={};
  const enemy=1-side;
  const k=choose(cells.filter(i=>pattern.location(coordinate(i))));
  const local=cells.filter(i=>dist(i,k)<=3);
  const centers=local.filter(i=>i!==k&&gameRules.isInnerHole(i)&&
    (kind==='pit'?dist(i,k)<=2:!gameRules.boardHoles(i).includes(k)));
  if(!centers.length)return null;
  const center=choose(centers);
  const holes=kind==='pit'?[center]:gameRules.boardHoles(center);
  const set=(type,owner,i,promoted=false)=>{
    b[i]=gameRules.piece(type,owner,promoted);
    counts[type]=(counts[type]||0)+1;
  };
  const place=(type,owner,domain,promoted=false)=>{
    if(counts[type]>=pieceCaps[type])return false;
    const free=domain.filter(i=>{
      if(b[i]||holes.includes(i)||!validSq(type,owner,i,promoted))return false;
      if(type==='P'&&!promoted&&b.some((j,index)=>j?.type==='P'&&j.side===owner&&!j.pr&&index%9===i%9))return false;
      return true;
    });
    if(!free.length)return false;
    set(type,owner,choose(free),promoted);
    return true;
  };
  const far=cells.filter(i=>dist(i,k)>=3);
  set('K',side,k);
  if(!place('K',enemy,far.filter(i=>dist(i,k)>=4)))return null;

  const checked=rnd()<0.9;
  if(checked){
    const threatType=choose(['R','R','B','B','L']);
    const [r,c]=coordinate(k);
    const threats=local.filter(i=>{
      if(b[i]||holes.includes(i)||!validSq(threatType,enemy,i,false))return false;
      const [rr,cc]=coordinate(i);
      const dr=rr-r, dc=cc-c;
      const ray=threatType==='R'?(dr===0||dc===0):threatType==='B'?Math.abs(dr)===Math.abs(dc):dc===0&&Math.sign(dr)===(enemy===0?1:-1);
      if(!ray)return false;
      for(let t=1;t<dist(i,k);t++){
        const j=9*(r+Math.sign(dr)*t)+c+Math.sign(dc)*t;
        if(b[j]||holes.includes(j))return false;
      }
      return true;
    });
    if(!threats.length)return null;
    set(threatType,enemy,choose(threats),threatType!=='L'&&rnd()<.22);
  }
  const supports=pattern.support.slice();
  for(let j=0;j<3;j++){
    const type=supports.splice(Math.floor(rnd()*supports.length),1)[0];
    place(type,enemy,local, type!=='G'&&rnd()<.20);
  }
  place(choose(['G','S','B','R','P']),side,local);
  place(choose(['L','N','P','S','P']),side,far);
  place(choose(['L','B','P','P','P']),enemy,far);
  if(rnd()<.8)place(choose(['S','G','N','P','P']),side,cells);
  if(rnd()<.65)place(choose(['P','G','R','P']),side,far);
  if(rnd()<.48)place(choose(['G','N','P']),enemy,far);
  const hands=[{},{}];
  if(rnd()<.18){
    const unit=choose(['G','S','P','N','B','R']);
    if((counts[unit]||0)<pieceCaps[unit])hands[enemy][unit]=1;
  }
  if(rnd()<.12){
    const unit=choose(['P','S','G']);
    if((counts[unit]||0)+Number(Boolean(hands[enemy][unit]))<pieceCaps[unit])hands[side][unit]=1;
  }
  const x=position(b,side,holes,hands,56+n%37);
  return {x,plannedCheck:checked,boardPieces:b.filter(Boolean).length};
}
async function ask(operation,x,depth){
  const sfen=toSfen(x,{allowHoles:true});
  oracle.stdin.write([operation,sfen,x.holes.map(square).join(','),depth].join('\t')+'\n');
  const answer=await replies.next();
  if(answer.done)throw Error('Independent solver closed');
  return JSON.parse(answer.value);
}
const otherStems=['unseen-attack.jsonl','unseen-opening.jsonl','unseen-midgame.jsonl'];
function excludeFresh(seen){
  for(const f of otherStems){
    if(!existsSync(resolve(here,f)))continue;
    for(const item of readList(f)){
      if(item.sfen&&item.holes)seen.add(canonical(positionFromSfen(item.sfen,item.holes)));
    }
  }
}
function assertExact(x,proof){
  assert.deepEqual(proof.available.slice().sort(),legal(x).map(toUsi).sort());
  assert.ok(proof.goodMoves.length&&proof.goodMoves.every(move=>proof.available.includes(move)));
  assert.equal(new Set([...proof.goodMoves,...Object.keys(proof.lossPliesAfterDefense)]).size,proof.available.length);
  assert.ok(Object.values(proof.lossPliesAfterDefense).includes(proof.depth));
}
async function generate(){
  const output=resolve(here,outputName);
  assert.ok(!existsSync(output),'Refusing to overwrite frozen defense file');
  const partial=output+'.progress';
  assert.ok(!existsSync(partial),'Use a new output filename to retain previous partial data');
  const seen=new Set(excluded);
  excludeFresh(seen);
  const entries=[];
  const bucket=(kind,depth,side)=>kind+'/'+depth+'/'+side;
  const quotas=new Set(kinds.flatMap(kind=>horizons.flatMap(depth=>[0,1].map(side=>bucket(kind,depth,side)))));
  for(let i=0;i<limit&&quotas.size;i++){
    const kind=kinds[i%2], side=(i/2|0)%2, pattern=patterns[(i/4|0)%patterns.length];
    const needed=horizons.filter(depth=>quotas.has(bucket(kind,depth,side)));
    if(!needed.length)continue;
    const candidate=direct(kind,side,pattern,i);
    totals.sampled++;
    if(!candidate||candidate.boardPieces<minPieces||candidate.boardPieces>maxPieces)continue;
    const {x,boardPieces}=candidate;
    if(!representable(x))continue;
    totals.representable++;
    const identity=canonical(x);
    if(seen.has(identity))continue;
    const roots=legal(x);
    if(roots.length<2||roots.length>maxRoot)continue;
    totals.legal++;
    const branches=new Set();
    let unknown=0;
    for(const move of roots){
      const fast=await ask('sample',play(x,move),needed.at(-1));
      totals.fastProbes++;
      if(fast.status==='limit'){totals.fastCap++;unknown++;}
      if(fast.status==='none'||fast.status==='invalid')unknown++;
      if(fast.status==='found'&&needed.includes(fast.depth))branches.add(fast.depth);
    }
    if(!unknown||!branches.size)continue;
    for(const depth of [...branches].sort((a,b)=>b-a)){
      const proof=await ask('escape',x,depth);
      totals.fullProbes++;
      if(proof.status==='limit')totals.rejectedCap++;
      if(proof.status!=='ok')continue;
      assertExact(x,proof);
      seen.add(identity);
      quotas.delete(bucket(kind,depth,side));
      const id=['unseen-defense',kind,depth,side].join('/');
      const entry={
        id,kind,horizon:depth,side,
        inCheck:gameRules.inCheck(x,side),family:pattern.name,pieces:boardPieces,
        category:'forced-loss-escape-'+depth,
        sfen:toSfen(x,{allowHoles:true}),holes:x.holes.map(square),
        available:proof.available.slice().sort(),goodMoves:proof.goodMoves.slice().sort(),proof,
      };
      entries.push(entry);
      appendFileSync(partial,JSON.stringify(entry)+'\n');
      console.log(JSON.stringify({event:'accepted',i,id,moves:entry.available.length,correct:entry.goodMoves.length,pieces:boardPieces,family:pattern.name,nodes:proof.nodes,remaining:[...quotas],totals}));
      break;
    }
    if(i>0&&i%1000===0)console.log(JSON.stringify({event:'sampling',i,remaining:[...quotas],totals}));
  }
  assert.ok(entries.length>=8,'Too few independently checked roots');
  const recent=new Set();
  excludeFresh(recent);
  assert.ok(entries.every(row=>!recent.has(canonical(positionFromSfen(row.sfen,row.holes)))),'Another fixture now shares a root identity');
  entries.sort((a,b)=>a.id.localeCompare(b.id));
  const payload=entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n';
  writeFileSync(output,payload,{flag:'wx'});
  const metadata={
    source:'Independent direct tactical defense roots. No predecessor attack positions, engine results, or app changes.',
    objective:'After one defensive move, survive the specified opponent forcing horizon. Each root includes an unsafe move with exactly that many plies to a no-legal-move loss.',
    seed,limit,minPieces,maxPieces,priorRoots:priorCount,
    rows:entries.length,missing:[...quotas],totals,sha256:hashes(payload),
    generatorSha256:hashes(readFileSync(fileURLToPath(import.meta.url))),
    solverSha256:hashes(readFileSync(solverPath)),
    sideAndHorizon:Object.fromEntries(entries.map(row=>[bucket(row.kind,row.horizon,row.side),1])),
  };
  writeFileSync(output+'.metadata.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'frozen',file:output,...metadata}));
}
async function check(){
  const seen=new Set(excluded);
  excludeFresh(seen);
  let nodes=0;
  const rows=readList(outputName);
  for(const entry of rows){
    const x=positionFromSfen(entry.sfen,entry.holes);
    const identity=canonical(x);
    assert.ok(!seen.has(identity),entry.id);
    seen.add(identity);
    const proof=await ask('escape',x,entry.horizon);
    assert.equal(proof.status,'ok',entry.id);
    assertExact(x,proof);
    assert.deepEqual(proof.goodMoves.slice().sort(),entry.goodMoves,entry.id);
    assert.deepEqual(proof.lossPliesAfterDefense,entry.proof.lossPliesAfterDefense,entry.id);
    assert.equal(proof.nodes,entry.proof.nodes,entry.id);
    nodes+=proof.nodes;
  }
  console.log(JSON.stringify({rows:rows.length,nodes,overlaps:0,sha256:hashes(readFileSync(resolve(here,outputName)))}));
}
try{
  if(mode==='generate')await generate();
  else if(mode==='verify')await check();
  else throw Error('Use generate or verify');
}finally{oracle.stdin.end();}
