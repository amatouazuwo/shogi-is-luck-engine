import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameRules, legal, pieceUnits, play, positionFromSfen } from '../../tactics/rules.mjs';
const {toUsi} = await import(strengthFileURL(strengthJoin(strengthGame, 'ai/rsshogi-position.mjs')));

const sdk=resolve(strengthJoin(strengthGame, 'ai/obstacle-sdk'));
const corpus=readFileSync('cases.jsonl','utf8').trim().split('\n').map(JSON.parse);
const wasm=readFileSync(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const moduleUrl=pathToFileURL(resolve(sdk,'worker.js')).href;
const print=value=>console.log(JSON.stringify(value));
const rounds=Number(process.argv[2]||2);
assert.equal(sha(wasm),'0aa92ee9c44cc31e82cf58e3338420d2efb75b60b7a14eb1a5c76d8b0c0d9108');
const stat=()=>Number(readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/nr_throttled (\d+)/)[1]);
print({event:'run',wasmSha256:sha(wasm),rounds,workerSha256:sha(readFileSync(resolve(sdk,'worker.js')))});

const worker=new Worker(`
  const {parentPort, workerData}=require('node:worker_threads');
  globalThis.self=globalThis;
  globalThis.postMessage=data=>parentPort.postMessage(data);
  const loaded=import(workerData);
  parentPort.on('message', async data=>{await loaded; self.onmessage({data});});
`,{eval:true,workerData:moduleUrl});
let sequence=0;
function command(command,args={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const finish=(error,result)=>{
      clearTimeout(timer);
      worker.off('message',onMessage);
      worker.off('error',onError);
      if(error)reject(error);
      else resolve(result);
    };
    const onError=error=>finish(error);
    const onMessage=message=>{
      if(message.id!==id||message.event==='info')return;
      finish(message.ok===false?Error(command+': '+message.error):null,message.result);
    };
    const timer=setTimeout(()=>finish(Error('timeout '+command)),12000);
    worker.on('message',onMessage);
    worker.on('error',onError);
    worker.postMessage({id,command,...args});
  });
}

function validateLine(pv,caseData){
  let p=positionFromSfen(caseData.sfen,caseData.holes);
  const initialSide=p.turn;
  let capturedBalance=0;
  return pv.map((usi,index)=>{
    const move=legal(p).find(m=>toUsi(m)===usi);
    assert.ok(move,caseData.id+' illegal PV ply '+index+': '+usi);
    const captured=p.board[move.to];
    const promoted=p.board[move.from]?.pr;
    capturedBalance+=(p.turn===initialSide?1:-1)*(pieceUnits[captured?.type]||0);
    p=play(p,move);
    return {move:usi,captured:captured?.type||null,promoted:move.promote||false,priorPromoted:promoted||false,
      capturedBalance,check:gameRules.inCheck(p,p.turn),replies:legal(p).length};
  });
}
try{
  await command('init',{wasm,hash_mb:16});
  for(let repeat=1;repeat<=rounds;repeat++){
    for(const p of (repeat%2?corpus:corpus.slice().reverse())){
      for(const original of p.trials){
        await command('new_game');
        const cpuBefore=stat();
        await command('position',{sfen:p.sfen,holes:p.holes,moves:[]});
        const result=await command('go',{depth:64,movetime_ms:original.budget});
        assert.ok(result.pv.length&&result.pv[0]===result.bestmove,JSON.stringify(result));
        print({id:p.id,repeat,budget:original.budget,originalMove:original.move,originalDepth:original.depth,
          reproduced:original.move===result.bestmove,matchedLabel:p.goodMoves.includes(result.bestmove),
          throttlingIntervals:stat()-cpuBefore,...result,line:validateLine(result.pv,p)});
      }
    }
  }
}finally{await worker.terminate();}
