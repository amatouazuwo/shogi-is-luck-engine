import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {SEARCH_CONTROL_CASES,searchRequest,auditSearch,verifyMatrix}
  from './search-control-contract.mjs';

const [, ,sdkArg,fixturesArg,reportArg]=process.argv;
assert.ok(sdkArg&&fixturesArg,
  'Usage: node probe-native-search-controls.mjs SDK_DIR HOLDOUT.jsonl [REPORT.md]');
verifyMatrix();
const sdk=resolve(sdkArg), wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const bootstrap='const {parentPort,workerData}=require("node:worker_threads");'+
  'globalThis.self=globalThis;globalThis.postMessage=x=>parentPort.postMessage(x);'+
  'const loaded=import(workerData);'+
  'parentPort.on("message",async data=>{await loaded;self.onmessage({data});});';
const worker=new Worker(bootstrap,{eval:true,
  workerData:pathToFileURL(resolve(sdk,'worker.js')).href});
let id=0;
function send(command,fields={},maxWait=20000){
  const requestId=++id;
  return new Promise((ok,fail)=>{
    const cleanup=()=>{clearTimeout(timer);worker.off('message',receive);worker.off('error',error)};
    const error=e=>{cleanup();fail(e)};
    const receive=m=>{
      if(m.id!==requestId||m.event==='info')return;
      cleanup();ok(m);
    };
    const timer=setTimeout(()=>error(Error(command+' timeout')),maxWait);
    worker.on('message',receive);worker.on('error',error);
    worker.postMessage({id:requestId,command,...fields});
  });
}
async function checked(cmd,fields={},wait){
  const r=await send(cmd,fields,wait);
  assert.equal(r.ok,true,'Worker '+cmd+': '+JSON.stringify(r));
  return r.result;
}
const rows=[];
try{
  await checked('init',{wasm,hash_mb:16},30000);
  // Depth-only is unsafe/unavailable for the cooperative Worker.
  const depthOnly=await send('go',{depth:2});
  assert.equal(depthOnly.ok,false);
  assert.match(depthOnly.error,/requires movetime_ms or nodes/);
  const invalidNodes=await send('go',{depth:64,nodes:0});
  assert.equal(invalidNodes.ok,false);
  const invalidDepth=await send('go',{depth:65,nodes:1000});
  assert.equal(invalidDepth.ok,false);

  const saved=readFileSync(resolve(fixturesArg),'utf8').trim().split('\n')
    .map(JSON.parse).filter(x=>x.event==='opening'&&x.pair===23);
  assert.equal(saved.length,2);
  assert.deepEqual(saved.map(x=>x.kind).sort(),['blackhole','pit']);
  const positions=[
    {id:'startpos',sfen:'startpos',holes:[]},
    ...saved.map(x=>({id:x.kind,sfen:x.sfen,holes:x.holes,legal:x.legal})),
  ];
  for(const pos of positions)for(const item of SEARCH_CONTROL_CASES){
    await checked('new_game');
    await checked('position',{sfen:pos.sfen,holes:pos.holes,moves:[]});
    const legal=await checked('legalMoves');
    assert.ok(Array.isArray(legal)&&legal.length);
    if(pos.legal!==undefined)assert.equal(legal.length,pos.legal);
    const req=searchRequest(item);
    const observed=auditSearch(await checked('go',req,20000),req,legal);
    const row={
      event:'search-control-observation',position:pos.id,profile:item.id,
      depthCap:req.depth,nodesCap:req.nodes??null,timeCapMs:req.movetime_ms??null,
      legalMoves:legal.length,...observed,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  assert.equal(rows.length,18);
  // The actual pinned C JSON API rejects rather than supports multipv=2.
  const {MiniEngine}=await import(pathToFileURL(resolve(sdk,'mini.js')).href);
  const native=await MiniEngine.create(wasm);
  try{
    assert.equal(native.request({command:'load_embedded'}).ok,true);
    assert.equal(native.request({command:'set_position',sfen:'startpos',moves:[]}).ok,true);
    const multi=native.request({command:'search',depth:2,nodes:1000,multipv:2});
    assert.equal(multi.ok,false,'MultiPV should NOT silently become available');
    assert.match(multi.error,/unknown field|multipv/i);
  }finally{native.dispose()}
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const final={
    event:'search-control-capability-summary',status:'PASS',
    sameNativeNNUE:true,checkedWorkerDepthLimit:true,checkedWorkerNodeLimit:true,
    nodeOnlySupported:true,depthOnlyRejected:true,
    multipleScoredRootMovesSupported:false,pvIsOneBestLine:true,
    observations:rows.length,positions:positions.length,
    wasmSha256:sha(wasm),workerSha256:sha(readFileSync(resolve(sdk,'worker.js'))),
    caution:'Capability only. Depth and node limits are upper bounds, not amateur rank or strength multipliers.',
  };
  console.log(JSON.stringify(final));
  if(reportArg){
    const header=['# Real rsshogi depth/node control probe','',
      '3 actual positions (startpos, pit, blackhole), 6 parameter configurations; same pinned NNUE and Worker.',
      '',
      '|Position|Probe|Depth cap|Node cap|Time cap ms|Observed depth|Nodes|PV moves|',
      '|---|---|---:|---:|---:|---:|---:|---:|'];
    const table=rows.map(x=>[
      x.position,x.profile,x.depthCap,x.nodesCap??'—',x.timeCapMs??'—',
      x.depth,x.nodes,x.pvLength
    ]).map(a=>'|'+a.join('|')+'|');
    const tail=['',
      'Worker: depth-only request rejected, node-only accepted. All best moves legal; node/depth caps audited.',
      'Native C API: multipv=2 rejected. pv is one best-line move sequence, not scored alternative root moves.',
      'No human amateur grade, Elo, game settings or production change established.',
      ''];
    writeFileSync(resolve(reportArg),[...header,...table,...tail].join('\n'));
  }
}finally{await worker.terminate()}
