// Diagnostic-only USI probe: isolates Gikou2 depth8 without NNUE / referee workload.
// Never runs against external playing sites, or configures a production CPU.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseUsiHandshake,referenceSettings} from './external-usi-calibration-contract.mjs';
import {FOUR_DAN_PROVISIONAL_GIKOU} from './gikou-reference-proxies.mjs';

const [, ,binaryArg,cwdArg,corpusArg]=process.argv;
assert.ok(binaryArg&&cwdArg&&corpusArg,
 'Usage: node gikou-depth8-isolated-smoke.mjs GIKOU_BINARY GIKOU_CWD OPENINGS.jsonl');
const entries=readFileSync(resolve(corpusArg),'utf8').trim().split('\n').map(JSON.parse)
 .filter(x=>x.event==='opening'&&x.family==='hirate'&&[8,9].includes(x.pair));
assert.equal(entries.length,2,'Two archived hirate openings required');
const engine=spawn(resolve(binaryArg),[],{cwd:resolve(cwdArg),stdio:['pipe','pipe','pipe']});
const stdout=createInterface({input:engine.stdout})[Symbol.asyncIterator]();
let exited=false,exitDetails=null,stderr='',pendingError=null,active='start';
const telemetry=[];
const memory=setInterval(()=>{
  if(exited||engine.pid==null)return;
  try{
    const status=readFileSync('/proc/'+engine.pid+'/status','utf8');
    const rss=Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1]??0);
    telemetry.push(rss);
  }catch{}
},200);
engine.on('exit',(code,signal)=>{exited=true;exitDetails={code,signal,active}});
engine.on('error',e=>{pendingError=String(e)});
engine.stdin.on('error',e=>{pendingError='stdin: '+e.message});
engine.stderr.on('data',buf=>{stderr=(stderr+buf.toString()).slice(-8000)});
function send(line){
  if(exited||engine.stdin.destroyed||pendingError)
    throw Error('Gikou no longer writable: '+JSON.stringify({exitDetails,pendingError,stderr}));
  engine.stdin.write(line+'\n');
}
async function readUntil(predicate,deadlineMs){
  const expires=Date.now()+deadlineMs;
  while(true){
    if(exited||pendingError)
      throw Error('Gikou ended before bestmove: '+JSON.stringify({exitDetails,pendingError,active,stderr}));
    const available=expires-Date.now();
    if(available<=0)throw Error('Gikou USI timeout '+JSON.stringify({active,exitDetails,pendingError,stderr}));
    let timer;
    const res=await Promise.race([
      stdout.next(),
      new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('USI deadline '+JSON.stringify({active,exitDetails,stderr}))),available)),
    ]).finally(()=>clearTimeout(timer));
    if(res.done){
      // The stdout close notification can race the child exit(code,signal) event.
      await new Promise(ok=>setTimeout(ok,100));
      throw Error('Gikou stdout closed '+JSON.stringify({active,exitDetails,
        pendingError,stderr,peakVmRssKiB:Math.max(0,...telemetry),
        recentInfo:telemetry.lastInfo??null}));
    }
    const line=res.value.trim();
    if(line.startsWith('info ')&&line.includes(' depth ')){
      // Only record the most recent progress, never stream hundreds of search lines.
      telemetry.lastInfo=line.slice(0,350);
    }
    if(predicate(line))return line;
  }
}
try{
  active='usi';send('usi');
  const hs=[];
  while(hs.at(-1)!=='usiok'){
    assert.ok(hs.length<200,'Unknown USI handshake');
    hs.push(await readUntil(()=>true,15000));
  }
  const identity=parseUsiHandshake(hs);
  assert.match(identity.name,/Gikou|技巧/i);
  active='ready';
  for(const c of referenceSettings(identity,{depth:FOUR_DAN_PROVISIONAL_GIKOU.depthLimit}).commands)send(c);
  send('isready');
  await readUntil(line=>line==='readyok',60000);
  console.log(JSON.stringify({event:'gikou-depth8-isolated-config',
    engine:identity.name,reference:FOUR_DAN_PROVISIONAL_GIKOU,
    openings:entries.map(x=>x.pair)}));
  // Captured directly from the failing full-game integration run (paired game 8, ply 118).
  // This is an ordinary-shogi SFEN with no obstacle data, not a fabricated puzzle.
  const failingPosition={pair:'8-ply118',opening:
    '6B1l/l4g+N1k/p4pspn/3P4p/7S1/3SP1P2/P2S1K1PP/5GG2/L7L b 2RB2N8Pg 127'};
  for(const test of [{depth:5,position:entries[0]},{depth:8,position:entries[0]},
    {depth:8,position:entries[1]},
    {depth:5,position:failingPosition},{depth:8,position:failingPosition}]){
    active='depth'+test.depth+'-pair'+test.position.pair;
    send('usinewgame');
    send('position sfen '+test.position.opening);
    const started=performance.now();
    send('go depth '+test.depth);
    const reply=await readUntil(s=>s.startsWith('bestmove '),90000);
    console.log(JSON.stringify({event:'gikou-depth8-isolated-search',
      pair:test.position.pair,requestedDepth:test.depth,
      bestmove:reply.split(/\s+/)[1],elapsedMs:Math.round(performance.now()-started),
      peakVmRssKiB:Math.max(0,...telemetry),
      info:telemetry.lastInfo??null}));
  }
  console.log(JSON.stringify({event:'gikou-depth8-isolated-complete',ok:true}));
}finally{
  clearInterval(memory);
  if(!exited&&!engine.stdin.destroyed&&!pendingError){
    try{send('quit')}catch{}
  }
  if(!exited)engine.kill();
}
