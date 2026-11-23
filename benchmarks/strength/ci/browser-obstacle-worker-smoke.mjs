// Real Chromium Web Worker + real rsshogi obstacle WASM/NNUE browser smoke.
// Only validate protocol correctness, not amateur strength or private game UI.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const sdk=resolve(process.argv[2]??'');
assert.ok(process.argv[2], 'Usage: node browser-obstacle-worker-smoke.mjs PATH_TO_SDK');
const allow=new Map([
  ['/sdk/worker.js','text/javascript; charset=utf-8'],
  ['/sdk/mini.js','text/javascript; charset=utf-8'],
  ['/sdk/rsshogi_nnue_mini.wasm','application/wasm'],
]);
const wasm=await readFile(join(sdk,'rsshogi_nnue_mini.wasm'));
const worker=await readFile(join(sdk,'worker.js'));
assert.ok(wasm.length>100000,'Expected full production-like embedded NNUE WASM');
const sha256=b=>createHash('sha256').update(b).digest('hex');
const server=createServer(async(req,res)=>{
  const route=new URL(req.url,'http://127.0.0.1').pathname;
  try{
    if(route==='/'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8',
        'cache-control':'no-store','cross-origin-resource-policy':'same-origin'});
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>Native Worker SDK smoke</body></html>');
      return;
    }
    if(!allow.has(route)){
      res.writeHead(404);res.end('Not Found');return;
    }
    const filename=route.slice('/sdk/'.length);
    const path=join(sdk,filename);
    const data=await readFile(path);
    res.writeHead(200,{'content-type':allow.get(route),
      'content-length':data.length,'cache-control':'no-store',
      'cross-origin-resource-policy':'same-origin'});
    res.end(data);
  }catch(err){res.writeHead(500);res.end(String(err));}
});
let browser;
try{
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')pageErrors.push('console: '+m.text())});
  await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
  const result=await page.evaluate(async()=>{
    const sfen='4k4/9/9/9/9/9/4P4/9/4K4 b - 1';
    const pit=['5e'];
    const blackhole=['6d','5d','4d','6e','5e','4e','6f','5f','4f'];
    const specs=[
      {name:'normal-1500ms',holes:[],go:{depth:64,movetime_ms:1500}},
      {name:'pit-25k',holes:pit,go:{depth:64,movetime_ms:500,nodes:25000}},
      {name:'blackhole-25k',holes:blackhole,go:{depth:64,movetime_ms:500,nodes:25000}},
    ];
    const sessions=[];
    let seq=0;
    const workerUrl='/sdk/worker.js';
    function spawn(){
      const w=new Worker(workerUrl,{type:'module'});
      const pending=new Map();
      const failures=[];
      w.addEventListener('message',e=>{
        const msg=e.data;
        const p=pending.get(msg?.id);
        if(!p)return;
        if(msg.event==='info'){p.info++;return;}
        pending.delete(msg.id);clearTimeout(p.timer);
        if(msg.ok===false)p.reject(Error(msg.error??'Worker failure'));else p.resolve({...msg,infos:p.info});
      });
      w.addEventListener('error',e=>{failures.push(String(e.message??e.type));
        for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Worker error: '+failures.at(-1)))}
        pending.clear();
      });
      return {
        failures,pending,
        send(command,fields={},limitMs=30000){
          const id=++seq;
          return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{pending.delete(id);reject(Error('Worker '+command+' timeout'))},limitMs);
            pending.set(id,{resolve,reject,timer,info:0});
            w.postMessage({id,command,...fields});
          });
        },
        terminate(){
          w.terminate();
          for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Worker terminated'))}
          pending.clear();
        },
      };
    }
    const hasMove=(result,move)=>Array.isArray(result)?result.includes(move):
      Array.isArray(result?.moves)?result.moves.includes(move):false;
    async function check(s,entry){
      const args={sfen,holes:s.holes,moves:[]};
      await entry.send('position',args);
      const legal=(await entry.send('legalMoves')).result;
      const out=await entry.send('go',s.go);
      const r=out.result;
      if(typeof r?.bestmove!=='string')throw Error(s.name+': no bestmove');
      if(!hasMove(legal,r.bestmove))throw Error(s.name+': illegal '+r.bestmove+' legal='+JSON.stringify(legal));
      if(!Number.isInteger(r.nodes)||r.nodes<0)throw Error(s.name+': missing search nodes');
      if(!Number.isInteger(r.depth)||r.depth<0)throw Error(s.name+': missing depth');
      if(s.go.nodes!==undefined && r.nodes>s.go.nodes)throw Error(s.name+': nodes cap exceeded');
      return {name:s.name,legal:legal.length??legal.moves?.length,move:r.bestmove,
        nodes:r.nodes,depth:r.depth,elapsed_ms:r.elapsed_ms,interimInfo:out.infos,cap:s.go.nodes??null};
    }
    let client=spawn();
    try{
      await client.send('init',{url:new URL('/sdk/rsshogi_nnue_mini.wasm',location.href).href,hash_mb:16},60000);
      for(const s of specs)sessions.push(await check(s,client));
      // The old active native Worker must be forcibly disposable while searching.
      await client.send('position',{sfen,holes:pit,moves:[]});
      const pending=client.send('go',{depth:64,movetime_ms:6000});
      await new Promise(resolve=>setTimeout(resolve,80));
      client.terminate();
      let cancelled=false;
      try{await pending}catch(e){cancelled=String(e).includes('terminated')}
      if(!cancelled)throw Error('Old native Worker search was not terminated');
      client=spawn();
      await client.send('init',{url:new URL('/sdk/rsshogi_nnue_mini.wasm',location.href).href,hash_mb:16},60000);
      sessions.push(await check({name:'worker-recreated-after-terminate',holes:blackhole,
        go:{depth:64,movetime_ms:250,nodes:25000}},client));
      if(client.pending.size!==0||client.failures.length)throw Error('Unhandled worker events after recovery');
    }finally{client.terminate()}
    return {status:'PASS',tests:sessions.length+1,sessions,workerCancelledAndRecreated:true};
  });
  assert.equal(result.status,'PASS');
  assert.equal(result.tests,5);
  assert.equal(result.workerCancelledAndRecreated,true);
  assert.deepEqual(pageErrors,[],'Chromium page errors');
  console.log(JSON.stringify({event:'rsshogi-real-browser-worker',
    browser:'Chromium',nativeWasmBytes:wasm.length,
    wasmSha256:sha256(wasm),workerSha256:sha256(worker),
    ...result}));
  await context.close();
}finally{
  await browser?.close().catch(()=>{});
  await new Promise(ok=>server.close(ok));
}
