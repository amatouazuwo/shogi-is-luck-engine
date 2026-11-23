import test from 'node:test';
import assert from 'node:assert/strict';
import {SEARCH_CONTROL_CASES,searchRequest,auditSearch,verifyMatrix} from './search-control-contract.mjs';
test('matrix isolates depth and nodes while matching wall time',()=>{
  assert.equal(verifyMatrix(),true);
  assert.equal(SEARCH_CONTROL_CASES.length,6);
});
test('Worker permits node-only but rejects depth-only configuration',()=>{
  assert.deepEqual(searchRequest({depth:64,nodes:500}),{depth:64,nodes:500});
  assert.throws(()=>searchRequest({depth:3}),/requires nodes or movetime/);
  assert.throws(()=>searchRequest({depth:0,nodes:500}),/Depth/);
  assert.throws(()=>searchRequest({depth:65,nodes:500}),/Depth/);
  assert.throws(()=>searchRequest({depth:3,nodes:0}),/nodes/);
  assert.throws(()=>searchRequest({depth:3,movetime_ms:-1}),/movetime/);
});
const legal=['7g7f','2g2f'];
const result=()=>({bestmove:'7g7f',score:10,depth:2,nodes:100,
  elapsed_ms:45,pv:['7g7f','3c3d']});
test('legal result with one PV and enforced search caps passes',()=>{
  const r=auditSearch(result(),{depth:2,nodes:100,movetime_ms:1000},legal);
  assert.equal(r.pvLength,2);
  assert.equal(r.depth,2);
});
test('depth, nodes, legality, and PV are separately guarded',()=>{
  for(const [patch,pattern] of [
    [{depth:4},/depth cap/],[{nodes:101},/Node budget/],
    [{bestmove:'1a1b'},/legal/],[{pv:['2g2f']},/PV root/],
    [{pv:[{bestmove:'7g7f',score:10}]},/one ordered line/],
  ])assert.throws(()=>auditSearch({...result(),...patch},
    {depth:2,nodes:100},legal),pattern);
});
test('legal depth-zero fallback with empty PV is permitted',()=>{
  const r=auditSearch({...result(),depth:0,nodes:0,pv:[]},{depth:2,nodes:1},legal);
  assert.equal(r.pvLength,0);
});
