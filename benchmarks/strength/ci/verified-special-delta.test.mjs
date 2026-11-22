import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
const script=resolve('benchmarks/strength/ci/verified-special-delta.mjs');
const fixtures=[
 {id:'pit-attack',kind:'pit',category:'forced-win-5',
  sfen:'4k4/9/9/9/9/9/9/9/4K4 b - 1',holes:['3e'],available:['A','B'],goodMoves:['A'],proof:{status:'ok'}},
 {id:'blackhole-defense',kind:'blackhole',category:'forced-loss-escape-3',
  sfen:'4k4/9/9/9/9/9/9/9/4K4 b - 1',holes:['3e','4e'],available:['A','B'],goodMoves:['B'],proof:{status:'ok'}}
];
function run(rows={}) {
 const cwd=mkdtempSync(join(tmpdir(),'verified-special-'));
 try{
  const data=(rows.fixtures??fixtures).map(JSON.stringify).join('\n')+'\n';
  const config={event:'config',positions:2,rounds:1,budgets:[100],
   corpusSha256:createHash('sha256').update(data).digest('hex'),
   sdk:[{name:'candidate',wasmSha256:'new'},{name:'baseline',wasmSha256:'old'}]};
  const trials=(rows.trials??[
   {id:'pit-attack',name:'candidate',move:'A'},
   {id:'pit-attack',name:'baseline',move:'B'},
   {id:'blackhole-defense',name:'candidate',move:'A'},
   {id:'blackhole-defense',name:'baseline',move:'B'}
  ]).map(x=>({...x,event:'trial',budget:100,kind:x.id.startsWith('pit')?'pit':'blackhole',
   category:x.id.startsWith('pit')?'forced-win-5':'forced-loss-escape-3',
   legal:true,correct:x.id.startsWith('pit')?x.move==='A':x.move==='B'}));
  writeFileSync(join(cwd,'fixtures.jsonl'),data);
  writeFileSync(join(cwd,'pairs.jsonl'),[config,...trials].map(JSON.stringify).join('\n')+'\n');
  const p=spawnSync(process.execPath,[script,'pairs.jsonl','fixtures.jsonl'],{cwd,encoding:'utf8',env:{...process.env,GITHUB_STEP_SUMMARY:''},timeout:5000});
  const output=p.status===0?JSON.parse(readFileSync(join(cwd,'results/verified-special-delta.json'),'utf8')):null;
  return {p,output};
 }finally{rmSync(cwd,{recursive:true,force:true});}
}
test('keeps verified attack gains separate from defense regressions',()=>{
 const {p,output}=run();
 assert.equal(p.status,0,p.stderr);
 assert.equal(output.positionCount,2);
 const attack=output.byBoardAndPurpose.find(x=>x.part==='attack');
 const defense=output.byBoardAndPurpose.find(x=>x.part==='defense');
 assert.deepEqual([attack.improved,attack.regressed],[1,0]);
 assert.deepEqual([defense.improved,defense.regressed],[0,1]);
 assert.equal(output.cases.filter(x=>x.changedMove).length,2);
});
test('refuses a missing opponent observation',()=>{
 const trials=[
  {id:'pit-attack',name:'candidate',move:'A'},
  {id:'pit-attack',name:'baseline',move:'B'},
  {id:'blackhole-defense',name:'candidate',move:'A'}
 ];
 const {p}=run({trials});
 assert.notEqual(p.status,0);assert.match(p.stderr,/Incomplete paired results/);
});
test('refuses illegal or unsupported regression measurements',()=>{
 const trials=[
  {id:'pit-attack',name:'candidate',move:'A',legal:false},
  {id:'pit-attack',name:'baseline',move:'B'},
  {id:'blackhole-defense',name:'candidate',move:'A'},
  {id:'blackhole-defense',name:'baseline',move:'B'}
 ];
 const {p}=run({trials});
 assert.notEqual(p.status,0);assert.match(p.stderr,/Invalid trial/);
});
test('refuses unproved fixture',()=>{
 const bad=structuredClone(fixtures);bad[1].proof.status='unknown';
 const {p}=run({fixtures:bad});
 assert.notEqual(p.status,0);assert.match(p.stderr,/Unproved fixture/);
});
