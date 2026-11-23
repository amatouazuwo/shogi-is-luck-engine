import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
const {matchLegal,toObstaclePosition,toSfen,toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const gameRoot = strengthGame;
const directories = {
  official:(process.env.NORMAL_SDK || strengthJoin(strengthGame, 'ai/sdk')),
  modified:resolve(gameRoot,'ai/obstacle-sdk'),
};
const variants = Object.keys(directories);
const modes = process.argv[2] === 'all' || !process.argv[2] ? ['fixed','switch','time'] : [process.argv[2]];
assert.ok(modes.every(mode=>['fixed','switch','time'].includes(mode)));
const engineFiles = Object.fromEntries(variants.map(name=>[name,resolve(directories[name],'rsshogi_nnue_mini.wasm')]));
const binaries = Object.fromEntries(variants.map(name=>[name,readFileSync(engineFiles[name])]));
const emit = data => console.log(JSON.stringify(data));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedModel = '787739972eabb5a1c42c471d178ac0c97b688dce35c72b4291e7e1eeefa9786f';
const expectedWasm = {
  official:'feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d',
  modified:'0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108',
};

function modelFingerprint(wasm) {
  const marker = Buffer.from('RSNNPKG\0');
  const matches = [];
  for (let offset=wasm.indexOf(marker); offset>=0; offset=wasm.indexOf(marker,offset+1)) {
    if (offset+28>wasm.length || wasm.readUInt16LE(offset+8)!==1 || wasm.readUInt16LE(offset+10)!==0) continue;
    const end = BigInt(offset+28)+wasm.readBigUInt64LE(offset+12)+wasm.readBigUInt64LE(offset+20);
    if (end>BigInt(wasm.length)) continue;
    const bytes = wasm.subarray(offset,Number(end));
    if (sha256(bytes)===expectedModel) matches.push({bytes:bytes.length,sha256:expectedModel});
  }
  assert.equal(matches.length,1);
  return matches[0];
}

const fingerprints = Object.fromEntries(variants.map(name=>[name,{
  wasm:sha256(binaries[name]),model:modelFingerprint(binaries[name]),
  worker:sha256(readFileSync(resolve(directories[name],'worker.js'))),
}]));
assert.deepEqual(Object.fromEntries(variants.map(name=>[name,fingerprints[name].wasm])),expectedWasm);
assert.deepEqual(fingerprints.official.model,fingerprints.modified.model);

const source = readFileSync(resolve(gameRoot,'index.html'),'utf8');
function section(first,last) {
  const start = source.indexOf(first);
  const end = source.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,first);
  return source.slice(start,end);
}
const random = Object.create(Math);
const game = new Function('Math',[
  section('const $=id=>','const names='),
  section('const rand=n=>','let g=null'),
  section('const shallowBoard=','function drawCeremony('),
  section('function repeatHash(','// Dedicated pre-match selection view.'),
  'return {blackholeCells,getLegal,independentBoard,inCheck,isInnerHole,piece,sim};',
].join('\n'))(random);

function newPosition(board, turns=0, steps=0, hands=[{},{}]) {
  return {board,turn:turns,steps,hands,holes:[]};
}

function parsePosition(sfen) {
  const [ranks,turn,hand,ply]=sfen.split(' ');
  const board = [];
  for (const rank of ranks.split('/')) {
    let promote=false;
    for (const token of rank) {
      if (token==='+') {promote=true;continue;}
      if (/[1-9]/.test(token)) board.push(...Array(Number(token)).fill(null));
      else board.push(game.piece(token.toUpperCase(),token===token.toUpperCase()?0:1,promote));
      promote=false;
    }
  }
  assert.equal(board.length,81);
  const hands=[{},{}];
  for (const [,number,symbol] of hand.matchAll(/(\d*)([RBGSNLPrbgsnlp])/g)) {
    hands[symbol===symbol.toUpperCase()?0:1][symbol.toUpperCase()]=Number(number||1);
  }
  return newPosition(board,turn==='b'?0:1,Number(ply)-1,hands);
}

function seededRandom(seed) {
  let state=seed;
  return () => {
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    return state/2**32;
  };
}

function generatedPosition(seed,plies) {
  random.random=seededRandom(seed);
  for (let attempt=0;attempt<100;attempt++) {
    const position = newPosition(game.independentBoard());
    while (position.steps<plies) {
      const legal=game.getLegal(position,position.turn);
      if (!legal.length) break;
      const move=legal[Math.floor(random.random()*legal.length)];
      const captured=position.board[move.to];
      if (captured) {
        assert.notEqual(captured.type,'K');
        const hand=position.hands[position.turn];
        hand[captured.type]=(hand[captured.type]||0)+1;
      }
      if (move.drop) position.hands[position.turn][move.drop]--;
      position.board=game.sim(position,move,position.turn).board;
      position.turn=1-position.turn;
      position.steps++;
    }
    if (position.steps===plies && game.getLegal(position,position.turn).length) return position;
  }
  throw Error(`Cannot generate a legal position for seed ${seed}`);
}

const positions = [
  ['standard-start',parsePosition('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1')],
  ['midgame',parsePosition('lr6l/4g1pkp/2ns1s3/4pp1SP/PPBP2Pp1/2gpPP3/2B2S3/2K6/L6RL w 4P2g3np 48')],
  ['promotion-zone',parsePosition('3gkg3/5s3/1+B2p1s1l/6n2/7R1/5N3/4P1S2/2BS1p3/3GK3L b Pr 112')],
  ['late-game-with-drops',parsePosition('4k4/9/4G4/9/9/9/9/9/4K4 b P 136')],
  ...[0,1,6,9,17,22,34,41].map((plies,index)=>[
    `random-seed-${4097+index}-ply-${plies}`,generatedPosition(4097+index,plies),
  ]),
];
const budgets=[100,500,1500];
const fixedWork=[
  {label:'fixed-depth',work:6,request:{depth:6}},
  ...[1000,5000,15000].map(work=>({label:'fixed-nodes',work,request:{depth:64,nodes:work}})),
];
const percentile=(values,p)=>{
  const sorted=values.toSorted((a,b)=>a-b);
  const index=(sorted.length-1)*p;
  const lower=Math.floor(index);
  const upper=Math.ceil(index);
  return sorted[lower]+(index-lower)*(sorted[upper]-sorted[lower]);
};
function readCgroup() {
  return Object.fromEntries(readFileSync('/sys/fs/cgroup/cpu.stat','utf8').trim().split('\n').map(row=>{
    const [name,value]=row.split(' ');
    return [name,Number(value)];
  }));
}
function cpuMilliseconds(start) {
  const {user,system}=process.threadCpuUsage(start);
  return (user+system)/1000;
}
const timePair=(before,after)=>({throttledPeriods:after.nr_throttled-before.nr_throttled,
  cgroupThrottledMs:(after.throttled_usec-before.throttled_usec)/1000});
const orderFor=index=>index%2?variants.toReversed():variants;
const normalized=result=>{
  const {elapsed_ms:elapsedMs,...stable}=result;
  return stable;
};
function recordOutcome(result,position,wall,threadCpuMs) {
  const {bestmove:move,score,depth,nodes,elapsed_ms:elapsed}=result;
  const legal=matchLegal(move,game.getLegal(position,position.turn))!==null;
  return {move,score,depth,nodes,elapsed,wall,threadCpuMs,legal,stable:normalized(result)};
}

function unwrap(result) {
  assert.ok(result.ok,JSON.stringify(result));
  return result.result;
}

function summarize(probe,work,pairs) {
  const results=Object.fromEntries(variants.map(name=>[
    name,{
      legal:pairs.filter(pair=>pair[name].legal).length,
      medianElapsedMs:percentile(pairs.map(pair=>pair[name].wall),.5),
      p95ElapsedMs:percentile(pairs.map(pair=>pair[name].wall),.95),
      medianThreadCpuMs:percentile(pairs.map(pair=>pair[name].threadCpuMs),.5),
      medianDepth:percentile(pairs.map(pair=>pair[name].depth),.5),
      medianNodes:percentile(pairs.map(pair=>pair[name].nodes),.5),
      ...(probe==='worker-time'?{
        medianWorkerMs:percentile(pairs.map(pair=>pair[name].elapsed),.5),
        worstWallOverrunMs:Math.max(...pairs.map(pair=>pair[name].wall-work)),
        worstWorkerOverrunMs:Math.max(...pairs.map(pair=>pair[name].elapsed-work)),
      }:{}),
    },
  ]));
  return {kind:'summary',probe,work,pairs:pairs.length,...results,
    identicalMoves:pairs.filter(({official,modified})=>official.move===modified.move).length,
    identicalScores:pairs.filter(({official,modified})=>official.score===modified.score).length,
    identicalResults:pairs.filter(({official,modified})=>JSON.stringify(official.stable)===JSON.stringify(modified.stable)).length,
    throttledPairs:pairs.filter(row=>row.throttledPeriods>0).length,
    medianPairedCpuChangePct:percentile(pairs.map(({official,modified})=>100*(modified.threadCpuMs/official.threadCpuMs-1)),.5),
    medianPairedNodesChangePct:percentile(pairs.map(({official,modified})=>100*(modified.nodes/official.nodes-1)),.5),
  };
}

emit({kind:'config',node:process.version,fingerprints,budgets,positions:positions.map(([name,position])=>({name,sfen:toSfen(position)})),
  cpuQuota:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()});

async function directEngine(name) {
  const {MiniEngine}=await import(pathToFileURL(resolve(directories[name],'mini.js')));
  const engine=await MiniEngine.create(binaries[name]);
  unwrap(engine.request({command:'load_embedded'}));
  unwrap(engine.request({command:'configure',hash_mb:16,threads:1}));
  return engine;
}

function directPosition(engine,position,holesField=false) {
  const sfen=toSfen(position,{allowHoles:holesField});
  assert.ok(sfen);
  if (holesField) {
    const holes=position.holes.length?toObstaclePosition(position).holes:[];
    unwrap(engine.request({command:'set_obstacle_position',sfen,holes}));
  } else {
    unwrap(engine.request({command:'set_position',sfen,moves:[]}));
  }
}

function directSearch(engine,position,request) {
  const begin=performance.now();
  const cpu=process.threadCpuUsage();
  const result=unwrap(engine.request({command:'search',...request}));
  return recordOutcome(result,position,performance.now()-begin,cpuMilliseconds(cpu));
}

async function fixedProbe() {
  const engines=Object.fromEntries(await Promise.all(variants.map(async name=>[name,await directEngine(name)])));
  try {
    for (const [name,engine] of Object.entries(engines)) {
      const position=positions[0][1];
      directPosition(engine,position);
      directSearch(engine,position,{depth:4});
    }
    for (const [workIndex,{label,work,request}] of fixedWork.entries()) {
      const pairs=[];
      for (const [index,[position,state]] of positions.entries()) {
        const start=readCgroup();
        const pair={kind:'pair',probe:label,work,position};
        for (const name of orderFor(index+workIndex)) {
          unwrap(engines[name].request({command:'new_game'}));
          directPosition(engines[name],state);
          pair[name]=directSearch(engines[name],state,request);
        }
        Object.assign(pair,timePair(start,readCgroup()));
        pairs.push(pair);
        emit(pair);
      }
      emit(summarize(label,work,pairs));
    }
  } finally {
    for (const engine of Object.values(engines)) engine.dispose();
  }
}

function withHazard(position,kind) {
  for (const [i,piece] of position.board.entries()) {
    if (piece || !game.isInnerHole(i)) continue;
    const holes=kind==='pit'?[i]:game.blackholeCells(i);
    const absorbed=holes.filter(j=>position.board[j]);
    if (kind==='blackhole' && (!absorbed.length || absorbed.some(j=>position.board[j].type==='K'))) continue;
    const board=position.board.map((piece,j)=>holes.includes(j)?null:piece);
    const state={...position,board,holes};
    if (game.inCheck(state,1-state.turn)) continue;
    const legal=game.getLegal(state,state.turn);
    const cleared=game.getLegal({...state,holes:[]},state.turn);
    if (legal.length && cleared.length && legal.length!==cleared.length) return {state,absorbed:absorbed.length};
  }
  return null;
}

async function switchProbe() {
  const engine=await directEngine('modified');
  const clean=await directEngine('modified');
  const work={depth:5};
  try {
    for (const [label,position] of positions.slice(4)) {
      for (const kind of ['pit','blackhole']) {
        const hazard=withHazard(position,kind);
        if (!hazard) continue;
        const before={...hazard.state,holes:[]};
        const legalBefore=game.getLegal(before,before.turn).map(toUsi).toSorted();
        const legalDuring=game.getLegal(hazard.state,hazard.state.turn).map(toUsi).toSorted();
        const getMoves=() => unwrap(engine.request({command:'legal_moves'})).toSorted();
        unwrap(engine.request({command:'new_game'}));
        directPosition(engine,before);
        assert.deepEqual(getMoves(),legalBefore);
        const beforeResult=directSearch(engine,before,work);
        directPosition(engine,hazard.state,true);
        assert.deepEqual(getMoves(),legalDuring);
        const duringResult=directSearch(engine,hazard.state,work);
        directPosition(engine,before,true);
        assert.deepEqual(getMoves(),legalBefore);
        const afterResult=directSearch(engine,before,work);
        unwrap(clean.request({command:'new_game'}));
        directPosition(clean,before);
        const freshResult=directSearch(clean,before,work);
        emit({kind:'transition',hazard:kind,position:label,absorbed:hazard.absorbed,
          switchover:[legalBefore.length,legalDuring.length,legalBefore.length],
          bestMoves:[beforeResult.move,duringResult.move,afterResult.move,freshResult.move],
          allLegal:[beforeResult,duringResult,afterResult,freshResult].every(result=>result.legal),
          clearedBestSame:afterResult.move===freshResult.move,
          clearedResultSame:JSON.stringify(afterResult.stable)===JSON.stringify(freshResult.stable)});
      }
    }
  } finally {
    engine.dispose();
    clean.dispose();
  }
}

class SdkWorker {
  constructor(name) {
    this.id=0;
    const workerUrl=pathToFileURL(resolve(directories[name],'worker.js')).href;
    this.worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {readFile}=require('node:fs/promises');
      const {fileURLToPath}=require('node:url');
      const loaded=import(workerData);
      const nativeFetch=globalThis.fetch;
      globalThis.fetch=async url=>String(url).startsWith('file:')
        ? new Response(await readFile(fileURLToPath(url))) : nativeFetch(url);
      globalThis.self=globalThis;
      let cpuStart;
      globalThis.postMessage=reply=>{
        if (reply.event==='bestmove' && cpuStart) {
          const {user,system}=process.threadCpuUsage(cpuStart);
          reply.threadCpuMs=(user+system)/1000;
        }
        parentPort.postMessage(reply);
      };
      parentPort.on('message',async data=>{
        await loaded;
        if(data.command==='go')cpuStart=process.threadCpuUsage();
        self.onmessage({data});
      });
    `,{eval:true,workerData:workerUrl});
  }

  request(command,fields={}) {
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error(command+' worker timeout')),20000);
      const cleanup=()=>{
        clearTimeout(timer);
        this.worker.off('message',receive);
        this.worker.off('error',finish);
      };
      const finish=(error,value)=>{
        cleanup();
        if(error)reject(error);
        else resolve(value);
      };
      const receive=message=>{
        if(message.id===id && message.event!=='info') finish(message.ok?null:Error(message.error),message);
      };
      this.worker.on('message',receive);
      this.worker.on('error',finish);
      this.worker.postMessage({id,command,...fields});
    });
  }

  close() {
    return this.worker.terminate();
  }
}

async function timeProbe() {
  const engines=Object.fromEntries(variants.map(name=>[name,new SdkWorker(name)]));
  try {
    for (const name of variants) {
      const engine=engines[name];
      const url=pathToFileURL(engineFiles[name]).href;
      await engine.request('init',{url,hash_mb:16});
      await engine.request('position',{sfen:toSfen(positions[0][1]),moves:[]});
      await engine.request('go',{depth:64,movetime_ms:100});
    }
    for (const [budgetIndex,work] of budgets.entries()) {
      const pairs=[];
      for (const [index,[position,state]] of positions.entries()) {
        const start=readCgroup();
        const pair={kind:'pair',probe:'worker-time',work,position};
        for (const name of orderFor(index+budgetIndex)) {
          const engine=engines[name];
          await engine.request('new_game');
          await engine.request('position',{sfen:toSfen(state),moves:[]});
          const begin=performance.now();
          const message=await engine.request('go',{depth:64,movetime_ms:work});
          pair[name]=recordOutcome(message.result,state,performance.now()-begin,message.threadCpuMs);
        }
        Object.assign(pair,timePair(start,readCgroup()));
        pairs.push(pair);
        emit(pair);
      }
      emit(summarize('worker-time',work,pairs));
    }
  } finally {
    await Promise.all(variants.map(name=>engines[name].close()));
  }
}

if (modes.includes('fixed')) await fixedProbe();
if (modes.includes('switch')) await switchProbe();
if (modes.includes('time')) await timeProbe();
