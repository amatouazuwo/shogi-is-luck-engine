import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';

const sdk = resolve(process.argv[2] ?? process.env.NORMAL_SDK ?? 'ai/sdk');
const wasm = await readFile(resolve(sdk,'rsshogi_nnue_mini.wasm'));
const moduleUrl = pathToFileURL(resolve(sdk,'mini.js')).href;
const script = new URL('./continuous-worker.mjs',import.meta.url).href;
const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
let seq = 0;

function create() {
  return new Worker(`
    const {parentPort, workerData} = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = data => parentPort.postMessage(data);
    const loaded = import(workerData);
    parentPort.on('message', async data => {
      await loaded;
      if (data.command === 'go') parentPort.postMessage({entered: data.id});
      self.onmessage({data});
    });
  `,{eval:true,workerData:script});
}

function wait(worker, predicate) {
  return new Promise((res, rej) => {
    function done(error,data) {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', done);
      if (error) rej(error);
      else res(data);
    }
    const timer = setTimeout(() => done(Error('Worker reply timeout')),10000);
    function onMessage(data) { if (predicate(data)) done(null,data); }
    worker.on('message',onMessage);
    worker.on('error',done);
  });
}

async function request(worker,command,fields={}) {
  const id=++seq;
  const completing=wait(worker, data => data.id === id);
  worker.postMessage({id,command,...fields});
  const data = await completing;
  assert.ok(data.ok,JSON.stringify(data));
  return data.result;
}

async function start(worker) {
  await request(worker,'init',{wasm,moduleUrl,hash_mb:16});
  await request(worker,'position',{sfen});
}

const first=create();
let oldReplies=0, killed;
try {
  await start(first);
  const id=++seq;
  first.on('message', data => { if (data.id === id) oldReplies++; });
  const entering=wait(first, data => data.entered === id);
  first.postMessage({id,command:'go',depth:64,movetime_ms:1500});
  await entering;
  await new Promise(resolve => setTimeout(resolve,40));
  const stopStarted=performance.now();
  const exitCode=await first.terminate();
  killed={exitCode,terminateMs:performance.now()-stopStarted};
  assert.equal(oldReplies,0,'cancelled Worker returned bestmove');
} finally {
  if (!killed) await first.terminate();
}

const restartStarted=performance.now();
const second=create();
try {
  await start(second);
  const result=await request(second,'go',{depth:64,movetime_ms:100});
  assert.match(result.bestmove,/^[1-9][a-i][1-9][a-i]\+?$/);
  console.log(JSON.stringify({oldReplies,...killed,restartAndMoveMs:performance.now()-restartStarted,
    bestmove:result.bestmove,nodes:result.nodes,depth:result.depth}));
} finally {
  await second.terminate();
}
