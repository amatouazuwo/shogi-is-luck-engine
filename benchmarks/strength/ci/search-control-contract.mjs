import assert from 'node:assert/strict';

// Test-only controls. These are NOT rankings or game difficulty presets.
export const SEARCH_CONTROL_CASES=Object.freeze([
  {id:'time-only',depth:64,movetime_ms:1000},
  {id:'depth-2',depth:2,nodes:250000,movetime_ms:1000},
  {id:'depth-4',depth:4,nodes:250000,movetime_ms:1000},
  {id:'nodes-500',depth:64,nodes:500,movetime_ms:1000},
  {id:'nodes-10000',depth:64,nodes:10000,movetime_ms:1000},
  {id:'nodes-only',depth:64,nodes:1000},
].map(Object.freeze));

export function searchRequest(profile){
  assert.ok(profile&&typeof profile==='object','Missing controls');
  assert.ok(Number.isInteger(profile.depth)&&profile.depth>=1&&profile.depth<=64,
    'Depth must be 1..64');
  for(const k of ['nodes','movetime_ms']){
    if(profile[k]!==undefined)
      assert.ok(Number.isSafeInteger(profile[k])&&profile[k]>0,
        k+' must be a positive safe integer');
  }
  assert.ok(profile.nodes!==undefined||profile.movetime_ms!==undefined,
    'Worker requires nodes or movetime_ms in addition to depth');
  return {depth:profile.depth,
    ...(profile.nodes===undefined?{}:{nodes:profile.nodes}),
    ...(profile.movetime_ms===undefined?{}:{movetime_ms:profile.movetime_ms})};
}
export function auditSearch(result,request,legal){
  searchRequest(request);
  assert.ok(Array.isArray(legal)&&legal.length,'Expected actual legal move set');
  assert.ok(result&&legal.includes(result.bestmove),'Search bestmove must be legal');
  assert.ok(Number.isSafeInteger(result.depth)&&result.depth>=0&&
    result.depth<=request.depth,'Search depth cap violated');
  assert.ok(Number.isSafeInteger(result.nodes)&&result.nodes>=0,
    'Invalid node count');
  if(request.nodes!==undefined)
    assert.ok(result.nodes<=request.nodes,'Node budget exceeded');
  assert.ok(Number.isFinite(result.score),'Numeric evaluation missing');
  assert.ok(Number.isFinite(result.elapsed_ms)&&result.elapsed_ms>=0,
    'Elapsed search time must be nonnegative');
  assert.ok(Array.isArray(result.pv)&&result.pv.every(x=>typeof x==='string'),
    'PV must be one ordered line of moves');
  if(result.pv.length)assert.equal(result.pv[0],result.bestmove,'PV root mismatch');
  return {bestmove:result.bestmove,score:result.score,depth:result.depth,
    nodes:result.nodes,elapsed_ms:result.elapsed_ms,pvLength:result.pv.length};
}
export function verifyMatrix(cases=SEARCH_CONTROL_CASES){
  assert.equal(cases.length,6);
  assert.equal(new Set(cases.map(x=>x.id)).size,6);
  for(const x of cases)searchRequest(x);
  const by=Object.fromEntries(cases.map(x=>[x.id,x]));
  assert.equal(by['depth-2'].nodes,by['depth-4'].nodes);
  assert.equal(by['depth-2'].movetime_ms,by['depth-4'].movetime_ms);
  assert.equal(by['nodes-500'].movetime_ms,by['nodes-10000'].movetime_ms);
  assert.equal(by['nodes-500'].depth,by['nodes-10000'].depth);
  assert.equal(by['nodes-only'].movetime_ms,undefined);
  return true;
}
