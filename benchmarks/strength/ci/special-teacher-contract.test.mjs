import test from 'node:test';
import assert from 'node:assert/strict';
import {TRIAL_NODE_TIERS,auditTeacherDataset} from './special-teacher-contract.mjs';

function sample(){
 const fixtures=[],rows=[];
 for(let i=0;i<6;i++)for(const kind of ['pit','blackhole']){
   const f={pair:21+i,kind,stage:['opening','middle','reduced'][i%3],
     sfen:'fixture-'+i+'-'+kind,holes:kind==='pit'?['5e']:['4d','5d'],legal:2};
   fixtures.push(f);
   rows.push({...f,legalMoves:['7g7f','2g2f'],
     teacher:{bestmove:'7g7f',depth:9,nodes:65000,elapsed_ms:6000,requestMs:6000},
     students:TRIAL_NODE_TIERS.map((cap,j)=>({
       nodeCap:cap,requestMs:1000,
       bestmove:j>1?'7g7f':'2g2f',score:35,depth:4,
       nodes:cap,elapsed_ms:70,sameMoveAsTeacher:j>1,
     }))});
 }
 return {fixtures,rows};
}
test('four independent node tiers and twelve archived boards',()=>{
 const {fixtures,rows}=sample();
 const s=auditTeacherDataset(rows,fixtures);
 assert.equal(s.positions,12);
 assert.deepEqual(s.across.map(x=>x.nodeCap),[500,2000,10000,50000]);
 assert.deepEqual(s.across.map(x=>x.matches),[0,0,12,12]);
 assert.equal(s.byStage.opening[0].samples,4);
 assert.equal(s.byObstacle.pit[0].samples,6);
 assert.equal(s.amateurRankEstablished,false);
 assert.equal(s.teacherIsGroundTruth,false);
});
test('illegality, score fabrication and a silently exceeded node cap fail',()=>{
 const a=sample();a.rows[0].students[0].bestmove='1a1b';
 assert.throws(()=>auditTeacherDataset(a.rows,a.fixtures),/independently legal/);
 const b=sample();b.rows[0].students[0].nodes=501;
 assert.throws(()=>auditTeacherDataset(b.rows,b.fixtures),/exceeded/);
 const c=sample();c.rows[0].students[0].score=NaN;
 assert.throws(()=>auditTeacherDataset(c.rows,c.fixtures),/numeric candidate score/);
});
test('wrong teacher move, bad pair identifier and fabricated agreement fail',()=>{
 const a=sample();a.rows[0].teacher.bestmove='9a9b';
 assert.throws(()=>auditTeacherDataset(a.rows,a.fixtures),/Teacher must choose/);
 const b=sample();b.rows[0].pair=999;
 assert.throws(()=>auditTeacherDataset(b.rows,b.fixtures),/Unknown teacher/);
 const c=sample();c.rows[0].students[0].sameMoveAsTeacher=true;
 assert.throws(()=>auditTeacherDataset(c.rows,c.fixtures),/miscounted/);
});
test('no skipped positions or duplicate positions can pass',()=>{
 const a=sample();a.rows.pop();
 assert.throws(()=>auditTeacherDataset(a.rows,a.fixtures),/All source positions/);
 const b=sample();b.rows[1].pair=b.rows[0].pair;b.rows[1].kind=b.rows[0].kind;
 assert.throws(()=>auditTeacherDataset(b.rows,b.fixtures),/Repeated teacher/);
});
