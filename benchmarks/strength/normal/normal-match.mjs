import { fileURLToPath as strengthPath, pathToFileURL as strengthFileURL } from 'node:url';
import { resolve as strengthJoin } from 'node:path';
const strengthArchive = strengthPath(new URL('../', import.meta.url));
const strengthGame = strengthJoin(process.env.GAME_REPO || strengthJoin(strengthArchive, '../../../shogi-is-luck'));
const strengthSdk = strengthJoin(process.env.OBSTACLE_SDK || strengthJoin(strengthGame, 'ai/obstacle-sdk'));

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const local = dirname(fileURLToPath(import.meta.url));
const {values: args} = parseArgs({options: {
  repo: {type:'string', default:strengthGame},
  sdk: {type:'string', default:(process.env.NORMAL_SDK || strengthJoin(strengthGame, 'ai/sdk'))},
  binary: {type:'string', default:resolve(local,'YaneuraOu-8.30git/source/YaneuraOu-by-gcc')},
  level: {type:'string', default:'100,500,1500'},
  family: {type:'string', default:'hirate'},
  pairs: {type:'string', default:'1'},
  'pair-offset': {type:'string', default:'0'},
  'ply-cap': {type:'string', default:'200'},
  calibration: {type:'string'},
  smoke: {type:'boolean'},
}});
const levels = args.level.split(',').map(Number);
const families = args.family.split(',');
const pairOffset = Number(args['pair-offset']);
const pairCount = Number(args.pairs);
const plyCap = Number(args['ply-cap']);
assert.ok(levels.every(level => [100,500,1500].includes(level)));
assert.ok(families.every(family => ['hirate','game'].includes(family)));
assert.ok(Number.isSafeInteger(pairCount) && pairCount > 0);
assert.ok(Number.isSafeInteger(pairOffset) && pairOffset >= 0);
assert.ok(Number.isSafeInteger(plyCap) && plyCap > 0);

const {toSfen, toUsi, matchLegal} = await import(pathToFileURL(resolve(args.repo,'ai/rsshogi-position.mjs')));
const source = await readFile(resolve(args.repo, 'index.html'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing game source section ${start}`);
  return source.slice(first, last);
}
const rules = [
  section('const $=id=>','const names='),
  section('const rand=n=>','let g=null'),
  section('const shallowBoard=','function drawCeremony('),
  section('function repeatHash(','// Dedicated pre-match selection view.'),
].join('\n');
const gameMath = Object.create(Math);
const game = new Function('Math', `${rules}\nreturn {getLegal, inCheck, independentBoard, repeatHash, piece, sim};`)(gameMath);

const initial = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL';
const lines = [
  [],
  ['7g7f','3c3d','2g2f','8c8d'],
  ['2g2f','8c8d','2f2e','8d8e'],
  ['7g7f','3c3d','8h2b+','3a2b'],
  ['7g7f','3c3d','6g6f','8c8d','7i7h','8d8e'],
  ['7g7f','8c8d','2g2f','8d8e','8h7g','3c3d'],
  ['7g7f','3c3d','7i6h','8c8d','2g2f','8d8e'],
  ['2g2f','3c3d','7g7f','8c8d','6i7h','4a3b'],
];
function empty(board) {
  return {board, hands:[{},{}], holes:[], turn:0, steps:0, time:[180_000,180_000]};
}
function decodeBoard(sfenBoard) {
  return Array.from(sfenBoard.replaceAll('/','').replace(/[1-9]/g, value => '-'.repeat(Number(value))))
    .map(symbol => symbol === '-' ? null : game.piece(symbol.toUpperCase(), Number(symbol !== symbol.toUpperCase())));
}
function play(position, move) {
  const {turn, board, hands} = position;
  const captured = board[move.to];
  assert.notEqual(captured?.type, 'K');
  if (captured) hands[turn][captured.type] = (hands[turn][captured.type] || 0) + 1;
  if (move.drop) hands[turn][move.drop]--;
  position.board = game.sim(position, move, turn).board;
  position.turn = 1 - turn;
  position.steps++;
}
function opening(family, pair) {
  if (family === 'game') {
    let seed = (92173 ^ Math.imul(pair + 1, 0x9e3779b9)) >>> 0;
    gameMath.random = () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 2**32);
    return empty(game.independentBoard());
  }
  const moves = lines[pair];
  assert.ok(moves, `No defined hirate opening at pair ${pair}`);
  const position = empty(decodeBoard(initial));
  for (const move of moves) {
    const legal = matchLegal(move, game.getLegal(position,position.turn));
    assert.ok(legal, `Invalid opening move ${move}`);
    play(position, legal);
  }
  return position;
}

class StockWorker {
  constructor(bytes) {
    this.seq = 0;
    this.bytes = bytes;
    const workerUrl = pathToFileURL(resolve(args.sdk, 'worker.js')).href;
    this.worker = new Worker(`
      const {parentPort, workerData} = require('node:worker_threads');
      globalThis.self = globalThis;
      globalThis.postMessage = data => parentPort.postMessage(data);
      const loaded = import(workerData);
      parentPort.on('message', async data => { await loaded; self.onmessage({data}); });
    `, {eval:true, workerData:workerUrl});
    this.worker.on('error', error => { this.failure = error; });
  }
  request(command, fields = {}, timeout = 15000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        this.worker.off('error', onError);
        this.worker.off('message', onMessage);
        if (error) reject(error);
        else resolve(result);
      };
      const onError = error => finish(error);
      const onMessage = message => {
        if (message.id !== id || message.event === 'info') return;
        finish(message.ok ? null : Error(`${command}: ${message.error}`), message.result);
      };
      const timer = setTimeout(() => finish(Error(`${command}: worker timeout`)), timeout);
      this.worker.on('error', onError);
      this.worker.on('message', onMessage);
      this.worker.postMessage({id,command,...fields});
    });
  }
  init() { return this.request('init',{wasm:this.bytes,hash_mb:16}); }
  reset() { return this.request('new_game'); }
  async search(sfen, ms) {
    await this.request('position',{sfen,moves:[]});
    const r = await this.request('go',{depth:64,movetime_ms:ms},ms+1750);
    return {move:r.bestmove, nodes:r.nodes, depth:r.depth, time:r.elapsed_ms};
  }
  done() { return this.worker.terminate(); }
}

class YaneuraOu {
  constructor(binary = args.binary) {
    this.proc = spawn(resolve(binary),[],{cwd:local,stdio:['pipe','pipe','pipe']});
    this.lines = createInterface({input:this.proc.stdout});
    this.proc.stderr.on('data', chunk => process.stderr.write(chunk));
    this.proc.on('error',error => { this.failure = error; });
  }
  send(command) { this.proc.stdin.write(`${command}\n`); }
  command(input, predicate, timeout = 15000) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const output = [];
      const complete = (error) => {
        clearTimeout(timer);
        this.lines.off('line', receive);
        this.proc.off('exit', exit);
        this.proc.off('error', errorExit);
        if (error) reject(error);
        else resolve(output);
      };
      const exit = code => complete(Error(`YaneuraOu exited (${code})`));
      const errorExit = error => complete(error);
      const receive = line => {
        output.push(line);
        if (predicate(line)) complete();
      };
      const timer = setTimeout(() => complete(Error(`${input}: USI timeout`)), timeout);
      this.lines.on('line',receive);
      this.proc.on('exit',exit);
      this.proc.on('error',errorExit);
      this.send(input);
    });
  }
  async init() {
    const usi = await this.command('usi', line => line === 'usiok');
    const settings = {
      Threads:1, USI_Hash:16, USI_OwnBook:'false', BookFile:'no_book', USI_Ponder:'false',
      EvalDir:resolve(local,'eval'), FV_SCALE:24, NetworkDelay:0, NetworkDelay2:0,
      EnteringKingRule:'NoEnteringKing', MultiPV:1,
    };
    for (const [name,value] of Object.entries(settings)) {
      assert.ok(usi.some(line => line.startsWith(`option name ${name} type `)), `YaneuraOu does not advertise ${name}`);
      this.send(`setoption name ${name} value ${value}`);
    }
    const ready = await this.command('isready',line => line === 'readyok');
    assert.ok(![...usi,...ready].some(line => /failed|error|not load|not found/i.test(line)), JSON.stringify({usi,ready}));
    return {id:usi.filter(line => line.startsWith('id ')),ready,settings};
  }
  async reset() {
    await this.command('isready',line => line === 'readyok');
    this.send('usinewgame');
  }
  async search(sfen,ms) {
    this.send(`position sfen ${sfen}`);
    const output = await this.command(`go movetime ${ms}`, line => line.startsWith('bestmove '),ms+1750);
    const move = output.at(-1).split(' ')[1];
    const info = output.slice(0,-1).findLast(line => /^info\s.*\b(?:nodes|depth)\s/.test(line)) || '';
    const field = name => Number(info.match(new RegExp(`\\b${name} (\\d+)`))?.[1] || 0);
    return {move, nodes:field('nodes'), depth:field('depth'), time:field('time')};
  }
  async done() {
    if (this.proc.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => this.proc.kill(),1000);
      this.proc.once('exit',() => { clearTimeout(timer); resolve(); });
      this.send('quit');
    });
  }
}

class IndependentReference extends YaneuraOu {
  constructor() { super(args.calibration); }
  async reply(command,timeout) {
    const lines = await this.command(command,line => line.startsWith('{'),timeout);
    const reply = JSON.parse(lines.at(-1));
    if (reply.error) throw Error(reply.error);
    return reply;
  }
  async init() {
    const id = await this.reply('id');
    assert.equal(id.version,'1.0');
    log('calibration-ready',id);
  }
  async reset() { assert.equal((await this.reply('reset')).ok,true); }
  async search(sfen,ms) {
    const r = await this.reply(`go\t${ms}\t${sfen}\t-`,ms+1750);
    return {move:r.bestmove, nodes:r.nodes, depth:r.depth, time:r.elapsed_ms};
  }
  async done() {
    if (this.proc.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => this.proc.kill(),1000);
      this.proc.once('exit',() => { clearTimeout(timer); resolve(); });
      this.proc.stdin.end();
    });
  }
}

const banks = [undefined,undefined];
const wasmBytes = await readFile(resolve(args.sdk,'rsshogi_nnue_mini.wasm'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(wasmBytes), 'feb190263b48caed5a81e0009cda35f6d2a23548ccf61d785f019420b857222d');

async function ready(index) {
  if (banks[index]) return banks[index];
  const engine = index === 1 ? new YaneuraOu() : args.calibration ? new IndependentReference() : new StockWorker(wasmBytes);
  try {
    const details = await engine.init();
    if (index === 1) log('usi-ready', details);
    banks[index] = engine;
    return engine;
  } catch (error) {
    await engine.done();
    throw error;
  }
}

function metrics() {
  return {moves:0, illegal:0, fallback:0, timeout:0, resign:0, declaration:0,
    wallMs:0, maxMs:0, over5ms:0, over50ms:0, depth:0, nodes:0, engineMs:0};
}
function log(event, fields) { console.log(JSON.stringify({event,...fields})); }
async function match(position, level, stockSide) {
  const stats = [metrics(),metrics()];
  const selected = [];
  const errors = [];
  const repetition = new Map();
  const initialStep = position.steps;
  for (let index=0; index<2; index++) await (await ready(index)).reset();
  let winner = null;
  let reason = 'ply-cap';
  for (let ply=0; ply<=plyCap; ply++) {
    const started = performance.now();
    const side = position.turn;
    const legal = game.getLegal(position,side);
    if (!legal.length) {
      winner = 1-side;
      reason = game.inCheck(position, side) ? 'checkmate' : 'no-legal';
      break;
    }
    if (ply === plyCap) break;
    const budget = Math.max(1,Math.min(level,Math.floor(position.time[side]/20),position.time[side]-150));
    const index = side === stockSide ? 0 : 1;
    const summary = stats[index];
    const sfen = toSfen(position);
    assert.ok(sfen);
    const engine = await ready(index);
    const searchStart = performance.now();
    let result;
    let move;
    try {
      result = await engine.search(sfen,budget);
      move = matchLegal(result.move,legal);
      if (!move) {
        if (result.move === 'resign') summary.resign++;
        else if (result.move === 'win') summary.declaration++;
        else summary.illegal++;
        errors.push({ply,index,sfen,reply:result.move});
      }
    } catch (error) {
      if (error.message.includes('timeout')) summary.timeout++;
      errors.push({ply,index,sfen,error:error.message});
      banks[index] = undefined;
      await engine.done();
    }
    if (!move) {
      summary.fallback++;
      move = legal.slice().sort((a,b) => toUsi(a).localeCompare(toUsi(b)))[0];
    }
    const elapsed = performance.now()-searchStart;
    summary.moves++;
    summary.wallMs += elapsed;
    summary.maxMs = Math.max(summary.maxMs,elapsed);
    summary.over5ms += Number(elapsed > budget+5);
    summary.over50ms += Number(elapsed > budget+50);
    summary.depth += result?.depth || 0;
    summary.nodes += result?.nodes || 0;
    summary.engineMs += result?.time || 0;
    position.time[side] -= performance.now()-started;
    if (position.time[side] <= 0) {
      winner = 1-side;
      reason = 'flag';
      break;
    }
    selected.push(toUsi(move));
    play(position,move);
    const key = game.repeatHash(position);
    const visits = (repetition.get(key) || 0)+1;
    repetition.set(key,visits);
    if (visits === 4) { reason = 'repetition'; break; }
  }
  return {stockSide,winner,reason,plies:position.steps-initialStep,stock:stats[0],reference:stats[1],clock:position.time,errors,selected};
}

try {
  log('config',{levels,families,pairCount,pairOffset,plyCap,wasmSha:sha(wasmBytes),rulesSha:sha(rules),
    engineSha:sha(await readFile(resolve(args.binary))),evalSha:sha(await readFile(resolve(local,'eval/nn.bin'))),
    calibrationSha:args.calibration ? sha(await readFile(resolve(args.calibration))) : null,
    node:process.version,mode:args.smoke?'smoke':'match'});
  if (args.smoke) {
    const position = opening('hirate',0);
    const sfen = toSfen(position);
    for (let i=0;i<2;i++) {
      const engine = await ready(i);
      for (const ms of levels) {
        const t = performance.now();
        const result = await engine.search(sfen,ms);
        assert.ok(matchLegal(result.move,game.getLegal(position,0)));
        assert.ok(result.nodes > 0);
        log('smoke',{engine:i,ms,wall:performance.now()-t,...result});
      }
    }
  } else {
    const start = toSfen(opening('hirate',0));
    for (let index=0; index<2; index++) {
      const result = await (await ready(index)).search(start,100);
      log('warmup',{index,...result});
    }
    for (const level of levels) for (let pair=pairOffset;pair<pairOffset+pairCount;pair++) for (const family of families) {
      const position = opening(family,pair);
      for (const side of [pair%2,1-pair%2]) {
        log('game-start',{family,level,pair,side,opening:toSfen(position)});
        const result = await match(structuredClone(position),level,side);
        log('game',{family,level,pair,opening:toSfen(position),...result});
      }
    }
  }
} finally {
  await Promise.all(banks.filter(Boolean).map(engine => engine.done()));
}
