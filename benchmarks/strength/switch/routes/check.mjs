import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium,devices} from '/workspace/shogi-is-luck/node_modules/playwright/index.mjs';

const game=strengthGame;
const port=8871;
const origin='http://127.0.0.1:'+port;
const profile=process.env.PROFILE||'desktop';
const absorbBlackhole=process.env.ABSORB_BLACKHOLE==='1';
const server=spawn(process.execPath,['server.js'],{cwd:game,env:{
  PORT:String(port),NODE_ENV:'test',RSSHOGI_TEST_ENABLED:'1',RSSHOGI_SERVE_ASSETS:'1',
  RENDER_EXTERNAL_HOSTNAME:'shogi-is-luck-test.onrender.com',
},stdio:['ignore','pipe','inherit']});
let browser;
try {
  const startup=await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw Error('server exit '+code);})]);
  assert.match(String(startup[0]),/localhost:8871/);
  assert.equal((await (await fetch(origin+'/health')).json()).status,'ok');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium'});
  const page=await browser.newPage(profile==='mobile'?devices['Pixel 7']:{});
  await page.route('**/*',route=>route.request().url().startsWith(origin+'/')&&!route.request().url().includes('/api/')?route.continue():route.abort());
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(origin,{timeout:60000});
  await page.waitForFunction(()=>typeof kickCPU==='function');
  await page.evaluate(async()=>{
    const {BrowserEngine}=await import('/ai/rsshogi-client.mjs');
    const {toUsi}=await import('/ai/rsshogi-position.mjs');
    if(window.SHOGILUCK_RSSHOGI_ENABLED!==true)throw Error('NNUE disabled');
    const choose=BrowserEngine.prototype.choose;
    const request=BrowserEngine.prototype.request;
    const apply=applyMove;
    const active=new WeakMap();
    window.routeRecords=[];
    window.appliedRecords=[];
    BrowserEngine.prototype.choose=async function(state,legal,budget,limits){
      const row={step:state.steps,side:state.turn,session:state.session,budget,maxWait:limits?.maxWait??null,
        sideTime:state.time[state.turn],holes:[...state.holes],worker:new URL(this.workerUrl).pathname,
        wasm:new URL(this.wasmUrl).pathname};
      const start=performance.now();
      active.set(this,row);
      try {
        const move=await choose.call(this,state,legal,budget,limits);
        row.matched=toUsi(move);
        row.chosenLegal=legal.includes(move);
        return move;
      }finally{
        row.chooseMs=performance.now()-start;
        window.routeRecords.push(row);
        active.delete(this);
      }
    };
    BrowserEngine.prototype.request=async function(command,fields,search){
      const row=active.get(this);
      if(row&&command==='position')row.position=fields;
      if(row&&command==='go')row.go=fields;
      if(row&&command==='go'&&window.invalidRequest){
        row.raw={bestmove:'5i1e'};
        return row.raw;
      }
      const result=await request.call(this,command,fields,search);
      if(row&&command==='go')row.raw=result;
      return result;
    };
    applyMove=(move,side)=>{
      const legal=getLegal(g,side).some(candidate=>['from','to','drop','promote','teleport','dragon'].every(k=>candidate[k]===move[k]));
      const result=apply(move,side);
      if(result)window.appliedRecords.push({side,step:g.steps,session:g.session,move:toUsi(move),legal});
      return result;
    };
    window.startFixture=async({budget,seed,cpu=0,holes=[],shortClock=false})=>{
      newGame();
      const random=Math.random;
      let state=seed>>>0;
      Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
      try {g.board=independentBoard();}finally{Math.random=random;}
      mode='cpu';localSide=1-cpu;g.turn=cpu;g.holes=holes;g.started=false;
      g.testMode=true;g.testTriggered=true;g.history={};
      window.routeRecords=[];window.appliedRecords=[];window.SHOGILUCK_RSSHOGI_BUDGET=budget;
      warmCpuEngine(holes.length?'obstacle':'normal');
      await (await cpuEnginePromise).init();
      if(shortClock)g.time[cpu]=1200;
      g.started=true;lastTick=Date.now();kickCPU();
      return g.session;
    };
    window.toHoleAndPlay=async({kind,absorbBlackhole})=>{
      window.previousNormal=await cpuEnginePromise;
      const candidates=[40,39,41,31,49].filter(i=>!g.board[i]);
      const center=absorbBlackhole&&kind==='blackhole'
        ? [49,48,50,31,30,32].find(i=>!g.board[i]&&blackholeCells(i).every(j=>g.board[j]?.type!=='K')&&blackholeCells(i).some(j=>g.board[j]))
        : 40;
      const holes=kind==='pit'?[candidates[0]]:blackholeCells(center);
      if(!holes.length||holes.some(i=>i==null||g.board[i]?.type==='K'))throw Error('invalid hole fixture');
      const absorbed=holes.filter(i=>g.board[i]).length;
      for(const i of holes)g.board[i]=null;
      g.holes=holes;
      // The real app preloads on the human turn. Await only this existing preload.
      kickCPU();await (await cpuEnginePromise).init();
      const legal=getLegal(g,localSide);
      const move=legal.find(m=>m.from!=null&&![...holes,30,31,32,39,40,41,48,49,50].includes(m.to))??legal[0];
      if(!move||!applyMove(move,localSide))throw Error('human move after obstacle setup failed');
      return {holes,absorbed};
    };
    window.clearHoleAndPlay=async()=>{
      window.previousObstacle=await cpuEnginePromise;
      g.holes=[];
      const legal=getLegal(g,localSide);
      if(!legal[0]||!applyMove(legal[0],localSide))throw Error('human move after obstacle removal failed');
    };
  });

  async function observe(step){
    await page.waitForFunction(step=>g.steps>=step||g.over,step,{timeout:20000});
    return page.evaluate(step=>({
      step:g.steps,over:g.over,reason:g.endReason,time:[...g.time],session:g.session,
      variant:cpuEngineVariant,record:window.routeRecords.find(r=>r.step===step-1),
      applied:window.appliedRecords.find(r=>r.step===step),
      normalReleased:window.previousNormal?.worker===null,
      obstacleReleased:window.previousObstacle?.worker===null,
    }),step);
  }
  function validate(result,session,budget,holes,clock=false,invalid=false){
    const {record,applied}=result;
    assert.equal(result.session,session);
    assert.equal(result.over,false,JSON.stringify(result));
    assert.equal(applied?.session,session);
    assert.ok(applied.legal,JSON.stringify(result));
    assert.equal(result.variant,holes.length?'obstacle':'normal');
    assert.equal(record.worker,holes.length?'/ai/obstacle-sdk/worker.js':'/ai/sdk/worker.js');
    assert.equal(record.wasm,record.worker.replace('worker.js','rsshogi_nnue_mini.wasm'));
    assert.deepEqual(record.holes,holes);
    const usi=holes.map(i=>String(9-i%9)+String.fromCharCode(97+Math.floor(i/9)));
    assert.deepEqual(record.position.holes,holes.length?usi:undefined);
    const expected=Math.max(1,Math.min(budget,Math.floor(record.sideTime/20),record.sideTime-150));
    assert.equal(record.budget,expected);
    assert.deepEqual(record.go,{depth:64,movetime_ms:expected});
    if(clock){
      assert.ok(record.budget<=60,JSON.stringify(result));
      assert.ok(result.time[record.side]>0);
    }else assert.equal(expected,budget);
    if(invalid){
      assert.equal(record.raw.bestmove,'5i1e');
      assert.equal(record.matched,null);
      assert.equal(record.chosenLegal,false);
    }else {
      assert.ok(record.chosenLegal,JSON.stringify(result));
      assert.equal(record.raw.bestmove,record.matched);
      assert.equal(applied.move,record.matched);
      assert.ok(record.raw.nodes>0);
    }
    return {requestedMs:record.budget,chooseMs:Math.round(record.chooseMs),elapsedMs:record.raw.elapsed_ms,
      nodes:record.raw.nodes,depth:record.raw.depth,move:applied.move,remainingMs:result.time[record.side]};
  }
  const budgets=[100,500,1500];
  for(const [index,budget] of budgets.entries()){
    for(const [kindIndex,kind] of ['pit','blackhole'].entries()){
      const session=await page.evaluate(async config=>await window.startFixture(config),
        {budget,seed:70123+index*1000+kindIndex*221,cpu:(index+kindIndex)%2});
      const before=validate(await observe(1),session,budget,[]);
      const effect=await page.evaluate(variant=>window.toHoleAndPlay(variant),{kind,absorbBlackhole});
      if(absorbBlackhole&&kind==='blackhole')assert.ok(effect.absorbed>0);
      const special=await observe(3);
      const withHole=validate(special,session,budget,effect.holes);
      assert.equal(special.normalReleased,true);
      await page.evaluate(async()=>await window.clearHoleAndPlay());
      const resumed=await observe(5);
      const after=validate(resumed,session,budget,[]);
      assert.equal(resumed.obstacleReleased,true);
      console.log(JSON.stringify({kind:'switch',profile,hazard:kind,budget,holes:effect.holes,absorbed:effect.absorbed,
        before,withHole,after,normalReleased:special.normalReleased,obstacleReleased:resumed.obstacleReleased}));
    }
  }
  for(const holes of [[],[40]]){
    const session=await page.evaluate(config=>window.startFixture(config),
      {budget:1500,seed:90120,holes,shortClock:true});
    const row=validate(await observe(1),session,1500,holes,true);
    console.log(JSON.stringify({kind:'short-clock',profile,holes,...row}));
  }
  const holes=[40];
  const session=await page.evaluate(async config=>{window.invalidRequest=true;return window.startFixture(config);},
    {budget:100,seed:70125,holes});
  const fallback=validate(await observe(1),session,100,holes,false,true);
  console.log(JSON.stringify({kind:'invalid-bestmove-fallback',profile,holes,...fallback}));
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({kind:'summary',profile,switches:6,realWasmAppliedMoves:20,legalFallbacks:1}));
} finally {
  await browser?.close();
  if(server.exitCode===null&&server.signalCode===null){
    server.kill('SIGTERM');
    await once(server,'exit');
  }
}
