import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { canonical, loadPrior } from './position-audit.mjs';
import { gameRules, legal, positionFromSfen, representable } from '../tactics/rules.mjs';
import { gameRepo, toUsi } from './game-context.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const filename='unseen-special.jsonl';
const groups=[
  {name:'attack',filename:'unseen-attack.jsonl',kind:'attack',perCell:2},
  {name:'defense',filename:'unseen-defense.jsonl',kind:'escape',perCell:1},
];
const old=loadPrior(),known=new Set(old),records=[],sources={};
const proofReplay=JSON.parse(readFileSync('proof-recheck.json','utf8'));
assert.equal(proofReplay.positions,36);
for(const group of groups){
  const content=readFileSync(group.filename,'utf8');
  const rows=content.trim().split('\n').map(JSON.parse);
  const checksum=hash(content);
  assert.equal(proofReplay.digests[group.filename],checksum);
  const counts={},families={},rootCheck={},hist={},sizes=[];
  for(const p of rows){
    assert.equal(p.proof.kind,group.kind,p.id);
    assert.equal(p.proof.depth,p.horizon,p.id);
    const key=canonical(p);
    assert.ok(!known.has(key),p.id+' prior or within-corpus equivalent');
    known.add(key);
    const x=positionFromSfen(p.sfen,p.holes);
    assert.equal(x.turn,p.side);
    assert.ok(representable(x),p.id);
    const size=x.board.filter(Boolean).length;
    assert.ok(size>=8,p.id);
    assert.equal(size,p.occupied??p.pieces);
    sizes.push(size);
    hist[size]=(hist[size]||0)+1;
    const checked=gameRules.inCheck(x,x.turn);
    rootCheck[String(checked)]=(rootCheck[String(checked)]||0)+1;
    if(p.inCheck!==undefined)assert.equal(checked,p.inCheck,p.id);
    if(p.kind==='pit')assert.ok(x.holes.length===1&&gameRules.isInnerHole(x.holes[0]),p.id);
    else{
      assert.equal(p.kind,'blackhole',p.id);
      assert.ok(x.holes.length===9&&x.holes.some(i=>gameRules.isInnerHole(i)&&gameRules.boardHoles(i).every(j=>x.holes.includes(j))),p.id);
    }
    assert.deepEqual(legal(x).map(toUsi).sort(),p.available,p.id);
    assert.ok(p.goodMoves.length>0&&p.goodMoves.every(m=>p.available.includes(m)),p.id);
    const stratum=[p.kind,p.horizon,p.side].join('/');
    counts[stratum]=(counts[stratum]||0)+1;
    families[p.family]=(families[p.family]||0)+1;
    if(group.kind==='escape'){
      const losses=p.proof.lossPliesAfterDefense;
      assert.ok(Object.values(losses).includes(p.horizon),p.id);
      assert.deepEqual(Object.keys(losses).sort(),p.available.filter(m=>!p.goodMoves.includes(m)),p.id);
    }
  }
  const expected=Object.fromEntries(['pit','blackhole'].flatMap(h=>[3,5,7].flatMap(depth=>[0,1].map(s=>[[h,depth,s].join('/'),group.perCell]))));
  assert.deepEqual(counts,expected);
  const sorted=sizes.sort((a,b)=>a-b), n=sorted.length;
  const median=(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2;
  sources[group.name]={filename:group.filename,checksum,count:n,strata:counts,families,rootCheck,occupancy:{minimum:sorted[0],median,maximum:sorted.at(-1),histogram:hist}};
  records.push(...rows);
}
assert.equal(known.size-old.size,records.length);
const bytes=groups.map(g=>readFileSync(g.filename,'utf8')).join('');
const metadata={
  filename,sha256:hash(bytes),positions:records.length,sources,priorCanonicalCount:old.size,priorOverlap:0,internalOverlap:0,
  exactOracleReplay:proofReplay,
  checkpointRule:'No NNUE engine result or timed outcome was used in selecting or labeling these fixtures.',
  gameRulesCommit:execFileSync('git',['-C',gameRepo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
};
if(process.argv.includes('--verify-only')){
  assert.equal(readFileSync(filename,'utf8'),bytes);
  assert.equal(JSON.parse(readFileSync(filename+'.metadata.json','utf8')).sha256,metadata.sha256);
}else{
  writeFileSync(filename,bytes,{flag:'wx'});
  writeFileSync(filename+'.metadata.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify(metadata,null,2));
