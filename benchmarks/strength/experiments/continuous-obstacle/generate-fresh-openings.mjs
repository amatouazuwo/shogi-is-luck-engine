import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Deterministic NEW obstacle layouts on previously archived NORMAL-board
// positions. These are fresh obstacle combinations, not sealed future holdouts.
// The independent referee supplies LEGAL MOVE COUNTS ONLY (never best moves).
const [refereeBinary,normalCorpus,outPath,seedText='20261122']=process.argv.slice(2);
assert.ok(refereeBinary&&normalCorpus&&outPath,'Usage: node generate-fresh-openings.mjs REFEREE NORMAL_OPENINGS.jsonl OUT.jsonl [SEED]');
assert.ok(/^\d{4,12}$/.test(seedText),'Seed must be numeric');
const seed=Number(seedText);
const raws=readFileSync(normalCorpus,'utf8');
const normal=raws.trim().split('\n').map(JSON.parse).filter(x=>x.event==='opening'&&['hirate','game'].includes(x.family));
assert.ok(normal.length>=12,'Need a diverse normal-opening input corpus');
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const occupied=(sfen)=>{
 const ranks=sfen.split(' ')[0].split('/');
 assert.equal(ranks.length,9,'Bad SFEN ranks');
 const board=Array.from({length:9},()=>Array(9).fill(false));
 for(let row=0;row<9;row++){
  let col=0;
  for(let k=0;k<ranks[row].length;k++){
   const ch=ranks[row][k];
   if(/[1-9]/.test(ch)){col+=Number(ch);continue;}
   if(ch==='+')continue;
   assert.ok(/[A-Za-z]/.test(ch),'Unrecognized SFEN piece '+ch);
   assert.ok(col<9,'Too many squares');
   board[row][col++]=true;
  }
  assert.equal(col,9,'Malformed rank '+row);
 }
 return board;
};
const square=(row,col)=>String(9-col)+String.fromCharCode(97+row);
const possibleBlackholes=(board)=>{
 const result=[];
 for(let row=1;row<=6;row++)for(let col=1;col<=6;col++){
  const coords=[];
  let empty=true;
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
   if(board[row+dy][col+dx])empty=false;
   coords.push(square(row+dy,col+dx));
  }
  if(empty)result.push(coords);
 }
 return result;
};
const score=x=>digest(seedText+':'+x);
const order=(a,b)=>score(a.opening).localeCompare(score(b.opening));
const options={hirate:normal.filter(x=>x.family==='hirate').sort(order),
 game:normal.filter(x=>x.family==='game').sort(order)};
const child=spawn(refereeBinary,[],{stdio:['pipe','pipe','inherit']});
const it=createInterface({input:child.stdout})[Symbol.asyncIterator]();
async function legalCount(sfen,holes){
 child.stdin.write('legal\t'+sfen+'\t'+holes.join(',')+'\n');
 let timeout;
 try{
  const response=await Promise.race([it.next(),new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('referee timeout')),8000))]);
  assert.ok(!response.done,'Referee exited');
  const parsed=JSON.parse(response.value);
  assert.ok(!parsed.error,parsed.error);
  assert.ok(Array.isArray(parsed.moves),'No reference legal move list');
  return parsed.moves.length;
 }finally{clearTimeout(timeout);}
}
const selected=[],seen=new Set();
try{
 for(let family of ['hirate','game']){
  for(const row of options[family]){
   if(selected.filter(x=>x.family===family).length>=3)break;
   if(seen.has(row.opening))continue;
   const board=occupied(row.opening);
   const blackholeOptions=possibleBlackholes(board).sort((a,b)=>
    score(row.opening+'/blackhole/'+a.join(',')).localeCompare(score(row.opening+'/blackhole/'+b.join(','))));
   if(!blackholeOptions.length)continue;
   const bh=blackholeOptions[0];
   const bhSet=new Set(bh);
   const single=[];
   for(let r=2;r<=6;r++)for(let c=1;c<=7;c++){
    const sq=square(r,c);
    if(!board[r][c]&&!bhSet.has(sq))single.push(sq);
   }
   single.sort((a,b)=>score(row.opening+'/pit/'+a).localeCompare(score(row.opening+'/pit/'+b)));
   if(!single.length)continue;
   const pit=[single[0]];
   // A referee is a sequential stdin/stdout request-response stream.
   // Parallel writes could mismatch counts to obstacle placements.
   const legalPit=await legalCount(row.opening,pit);
   const legalBH=await legalCount(row.opening,bh);
   if(legalPit<5||legalBH<5)continue;
   seen.add(row.opening);
   selected.push({...row,pit,bh,legalPit,legalBH});
  }
 }
}finally{child.kill();}
assert.equal(selected.length,6,'Need 3 distinct opening positions per family with playable obstacle placements');
const fixtures=[];
selected.sort((a,b)=>a.family.localeCompare(b.family)||a.pair-b.pair);
for(let i=0;i<selected.length;i++){
 const x=selected[i],pair=100+i;
 for(const kind of ['pit','blackhole']){
  const holes=kind==='pit'?x.pit:x.bh;
  fixtures.push({pair,kind,sfen:x.opening,holes,
   legal:kind==='pit'?x.legalPit:x.legalBH,
   sourceFamily:x.family,sourcePair:x.pair,sourceSfenSha256:digest(x.opening)});
 }
}
mkdirSync(dirname(outPath),{recursive:true});
writeFileSync(outPath,fixtures.map(JSON.stringify).join('\n')+'\n');
console.log(JSON.stringify({seed,openingCount:selected.length,fixtureCount:fixtures.length,
 normalCorpusSha256:digest(raws),generatedSha256:digest(readFileSync(outPath)),
 kinds:{hirate:selected.filter(x=>x.family==='hirate').length,
 game:selected.filter(x=>x.family==='game').length},
 samples:fixtures.map(x=>({pair:x.pair,kind:x.kind,holes:x.holes,legal:x.legal,
  sourceFamily:x.sourceFamily,sourcePair:x.sourcePair}))}));
