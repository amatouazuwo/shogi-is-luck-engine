import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { gameRules, legal, position, representable, seedRng, square } from '../tactics/rules.mjs';
import { toSfen, toUsi } from './game-context.mjs';
import { canonical, loadPrior } from './position-audit.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const {values:args}=parseArgs({options:{
  solver:{type:'string',default:resolve(here,'../forensics/heldout/solve')},
  output:{type:'string',default:resolve(here,'unseen-attack.jsonl')},
  quota:{type:'string',default:'4'},
  attempts:{type:'string',default:'30000'},
  seed:{type:'string',default:'0x2d7ae913'},
}});
const seed=Number(args.seed);
const random=seedRng(seed);
const attempts=Number(args.attempts),quota=Number(args.quota);
assert.ok(Number.isSafeInteger(seed)&&Number.isSafeInteger(attempts)&&attempts>0&&[2,4,6].includes(quota));
const kinds=['pit','blackhole'], horizons=[3,5,7], cells=Array.from({length:81},(_,i)=>i);
const row=i=>i/9|0;
const col=i=>i%9;
const distance=(a,b)=>Math.max(Math.abs(row(a)-row(b)),Math.abs(col(a)-col(b)));
const choose=domain=>domain[Math.floor(random()*domain.length)];
const limits={R:2,B:2,G:4,S:4,N:4,L:4,P:18};
const families=[
  {id:'central-fork',region:i=>row(i)>=2&&row(i)<=6&&col(i)>=2&&col(i)<=6,close:['G','B','S','N'],far:['R','L','P']},
  {id:'rank-edge-net',region:i=>(row(i)===0||row(i)===8)&&col(i)>=1&&col(i)<=7,close:['G','R','S','L'],far:['N','B','P']},
  {id:'side-lane-recapture',region:i=>(col(i)===0||col(i)===8)&&row(i)>=2&&row(i)<=6,close:['B','L','R','P'],far:['G','N','S']},
  {id:'offset-hole-cross',region:i=>[1,2,6,7].includes(row(i))&&[1,2,3,5,6,7].includes(col(i)),close:['R','B','N','S'],far:['G','S','P']},
  {id:'corner-approach',region:i=>(row(i)<=1||row(i)>=7)&&(col(i)<=2||col(i)>=6),close:['B','G','N','P'],far:['R','L','S']},
];
const valid=(type,owner,i,promoted)=>{
  if(promoted)return true;
  const rank=owner===0?row(i):8-row(i);
  return type==='N'?rank>=2:type==='P'||type==='L'?rank>=1:true;
};
function makePosition(kind,side,geometry) {
  const board=Array(81).fill(null), defender=1-side;
  const enemyKing=choose(cells.filter(geometry.region));
  const area=cells.filter(i=>distance(i,enemyKing)<=4);
  const close=area.filter(i=>distance(i,enemyKing)<=3);
  const remote=cells.filter(i=>distance(i,enemyKing)>=3);
  const centers=area.filter(i=>gameRules.isInnerHole(i)&&i!==enemyKing&&
    (kind==='pit'||!gameRules.boardHoles(i).includes(enemyKing)));
  if(!centers.length)return null;
  const chosen=choose(centers);
  const holes=kind==='pit'?[chosen]:gameRules.boardHoles(chosen);
  const used={};
  const put=(type,owner,region,initiallyPromoted=false)=>{
    if(type!=='K'&&(used[type]||0)>=limits[type])return false;
    const validCells=region.filter(i=>!board[i]&&!holes.includes(i)&&valid(type,owner,i,initiallyPromoted)&&
      !(type==='P'&&!initiallyPromoted&&board.some((p,j)=>p?.side===owner&&p.type==='P'&&!p.pr&&col(i)===col(j))));
    if(!validCells.length)return false;
    board[choose(validCells)]=gameRules.piece(type,owner,initiallyPromoted);
    used[type]=(used[type]||0)+1;
    return true;
  };
  board[enemyKing]=gameRules.piece('K',defender,false);
  if(!put('K',side,remote))return null;
  for(const type of geometry.close)put(type,side,close,type!=='G'&&random()<.17);
  for(const type of geometry.far)if(random()<.73)put(type,side,area);
  const nearDefenders=['G','S','P'];
  for(const type of nearDefenders)if(random()<.54)put(type,defender,area);
  const farDefenders=['P','N','L','B','R'];
  for(const type of farDefenders)if(random()<.51)put(type,defender,remote);
  const hands=[{},{}];
  if(random()<.22){
    const type=choose(['R','B','G','S','N','L','P']);
    if((used[type]||0)<limits[type])hands[side][type]=1;
  }
  if(random()<.07){
    const type=choose(['G','S','P']);
    if((used[type]||0)+(hands[side][type]||0)<limits[type])hands[defender][type]=1;
  }
  const material=board.filter(Boolean).length;
  if(material<9||material>16)return null;
  return {state:position(board,side,holes,hands,0),material};
}

const solver=spawn(args.solver,{stdio:['pipe','pipe','inherit']});
const iter=createInterface({input:solver.stdout,crlfDelay:Infinity})[Symbol.asyncIterator]();
async function ask(mode,p,depth){
  solver.stdin.write([mode,p.sfen,p.holes.join(','),depth].join('\t')+'\n');
  const response=await iter.next();
  if(response.done)throw Error('Independent C++ solver closed');
  return JSON.parse(response.value);
}
const progress=args.output+'.progress';
writeFileSync(progress,'',{flag:'wx'});
const rows=[];
const seen=loadPrior(), oldCount=seen.size, stats={submitted:0,checkingProofs:0,screenCaps:0,fullCaps:0};
const group=(kind,depth)=>rows.filter(r=>r.kind===kind&&r.horizon===depth);
const full=()=>kinds.every(kind=>horizons.every(depth=>group(kind,depth).length===quota));
try {
  for(let i=0;i<attempts&&!full();i++){
    const kind=kinds[i%2],side=i/2%2|0,geometry=families[(i/4|0)%families.length];
    const canAdd=horizons.some(depth=>group(kind,depth).filter(p=>p.side===side).length<quota/2);
    if(!canAdd)continue;
    const next=makePosition(kind,side,geometry);
    if(!next||!representable(next.state)||gameRules.inCheck(next.state,side))continue;
    const x=next.state;
    const candidate={sfen:toSfen(x,{allowHoles:true}),holes:x.holes.map(square),kind,side,family:geometry.id,
      occupied:next.material,seed,attempt:i};
    const key=canonical(candidate);
    if(seen.has(key))continue;
    stats.submitted++;
    const hint=await ask('sample',candidate,7);
    if(hint.status==='limit')stats.screenCaps++;
    if(hint.status!=='found')continue;
    stats.checkingProofs++;
    if(!horizons.some(depth=>depth<=hint.depth&&group(kind,depth).filter(p=>p.side===side).length<quota/2))continue;
    const proof=await ask('attack',candidate,hint.depth);
    if(proof.status==='limit')stats.fullCaps++;
    if(proof.status!=='ok'||!horizons.includes(proof.depth))continue;
    const current=group(kind,proof.depth);
    if(current.length>=quota||current.filter(p=>p.side===side).length>=quota/2||
      current.filter(p=>p.family===geometry.id).length>=Math.ceil(quota/2))continue;
    if(proof.goodMoves.length>Math.max(4,Math.floor(proof.available.length/3)))continue;
    const available=legal(x).map(toUsi).sort();
    assert.deepEqual(proof.available.slice().sort(),available,candidate.sfen);
    const goodMoves=proof.goodMoves.slice().sort();
    assert.ok(goodMoves.length&&goodMoves.every(m=>available.includes(m)),candidate.sfen);
    seen.add(key);
    const result={...candidate,id:['unseen',kind,'win'+proof.depth,String(current.length+1).padStart(2,'0')].join('/'),
      category:'forced-win-'+proof.depth,horizon:proof.depth,available,goodMoves,proof};
    rows.push(result);
    appendFileSync(progress,JSON.stringify(result)+'\n');
    console.log(JSON.stringify({event:'accepted',id:result.id,side,family:geometry.id,occupied:next.material,nodes:proof.nodes,attempt:i,stats}));
  }
}finally{
  solver.stdin.end();
}
const sha=contents=>createHash('sha256').update(contents).digest('hex');
const tallies=Object.fromEntries(kinds.flatMap(kind=>horizons.map(depth=>[kind+'/'+depth,group(kind,depth).length])));
assert.ok(rows.length>=12 && Object.values(tallies).every(n=>n>=1),'Apparently insufficient exact attack cases '+JSON.stringify(tallies));
const body=rows.sort((a,b)=>a.id.localeCompare(b.id)).map(p=>JSON.stringify(p)).join('\n')+'\n';
writeFileSync(args.output,body,{flag:'wx'});
const metadata={event:'frozen',seed,attempts,quota,output:args.output,positions:rows.length,tallies,stats,oldCount,
  corpusSha256:sha(body),solverSha256:sha(readFileSync(args.solver)),priorSha256:sha(readFileSync(resolve(here,'prior-special-identities.json'))),
  objective:'Shortest bounded forced win by exhausting the opponent’s legal moves. Checking-only search selects candidates; exact full-width proof supplies every answer and rejects smaller winning horizons.',
  generation:'Seeded constructed positions with 9–16 occupied cells and asymmetric local/remote material; no timed NNUE, no outcome tuning.',
};
writeFileSync(args.output+'.metadata.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(metadata));
