// Compare the actual engine behavior of two independently rebuilt WASM files.
// Same source/Worker, fixed boards and node caps; timing-dependent values
// deliberately excluded from strict comparisons. This is NOT a proof that two
// different binary files implement equivalent behavior for every position.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const [aDir,bDir]=process.argv.slice(2);
assert.ok(aDir&&bDir,'Usage: node wasm-behavior-diff.mjs SDK_A SDK_B');
const file=(dir,name)=>readFileSync(join(resolve(dir),name));
const sha=b=>createHash('sha256').update(b).digest('hex');
const wasmA=file(aDir,'rsshogi_nnue_mini.wasm'),wasmB=file(bDir,'rsshogi_nnue_mini.wasm');
const miniA=file(aDir,'mini.js'),miniB=file(bDir,'mini.js');
const workerA=file(aDir,'worker.js'),workerB=file(bDir,'worker.js');
assert.equal(sha(miniA),sha(miniB),'Identical mini.js required');
assert.equal(sha(workerA),sha(workerB),'Identical Worker JS required');
const {MiniEngine}=await import(pathToFileURL(join(resolve(aDir),'mini.js')).href);

const positions=[
  {id:'normal',holes:[],sfen:'4k4/9/9/9/9/9/4P4/9/4K4 b - 1'},
  {id:'pit',holes:['5e'],sfen:'4k4/9/9/9/9/9/4P4/9/4K4 b - 1'},
  {id:'blackhole',holes:['6d','5d','4d','6e','5e','4e','6f','5f','4f'],
    sfen:'4k4/9/9/9/9/9/4P4/9/4K4 b - 1'},
];
// Vary budget but keep it as an exact node bound, not an elapsed time bound.
const caps=[5000,25000];
function ask(engine,command,fields={}){
  const r=engine.request({command,...fields});
  if(!r.ok)throw Error(command+' failed: '+r.error);
  return r.result;
}
async function run(bytes){
  const e=await MiniEngine.create(bytes);
  const out=[];
  try{
    ask(e,'load_embedded');
    ask(e,'configure',{hash_mb:16,threads:1});
    for(const p of positions)for(const cap of caps){
      ask(e,'new_game');
      if(p.holes.length)
        ask(e,'set_obstacle_position',{sfen:p.sfen,holes:p.holes});
      else
        ask(e,'set_position',{sfen:p.sfen,moves:[]});
      const legal=ask(e,'legal_moves').slice().sort();
      assert.ok(legal.length>0,p.id+' has no legal moves');
      const result=ask(e,'search',{depth:64,nodes:cap});
      assert.ok(result&&typeof result.bestmove==='string',p.id+' missing bestmove');
      assert.ok(legal.includes(result.bestmove),p.id+' returned illegal move');
      assert.ok(Number.isInteger(result.nodes)&&result.nodes>=0&&result.nodes<=cap,
        p.id+' exceeded node cap');
      assert.ok(Number.isInteger(result.depth)&&result.depth>=0);
      const record={
        position:p.id,nodesCap:cap,legal,
        move:result.bestmove,nodes:result.nodes,depth:result.depth,
        score:result.score,pv:result.pv,
      };
      out.push(record);
    }
    return out;
  }finally{e.dispose()}
}
const left=await run(wasmA),right=await run(wasmB);
const cases=left.map((a,i)=>{
  const b=right[i];
  assert.equal(a.position,b.position);
  assert.equal(a.nodesCap,b.nodesCap);
  const fields=['legal','move','nodes','depth','score','pv'];
  const same=fields.filter(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
  const different=fields.filter(k=>!same.includes(k));
  return {position:a.position,nodesCap:a.nodesCap,
    identical:!different.length,differentFields:different,
    left:{move:a.move,nodes:a.nodes,depth:a.depth,score:a.score},
    right:{move:b.move,nodes:b.nodes,depth:b.depth,score:b.score}};
});
const report={
  event:'wasm-native-behavior-crosscheck',
  wasmByteIdentical:sha(wasmA)===sha(wasmB),
  shaLeft:sha(wasmA),shaRight:sha(wasmB),
  sameWorker:true,sameMiniJs:true,
  comparisons:cases.length,
  identicalCases:cases.filter(c=>c.identical).length,
  divergentCases:cases.filter(c=>!c.identical).length,
  cases,
  gradeValidation:'NOT_PERFORMED',
  limitations:'6 fixed node-budget searches, not proof of semantic equivalence; does not use private game WASM or browser clock',
};
console.log(JSON.stringify(report));
