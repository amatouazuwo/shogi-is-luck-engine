import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const {values: options} = parseArgs({options: {
  'game-root': {type: 'string', default: process.env.GAME_REPO || fileURLToPath(new URL('../../../shogi-is-luck/', import.meta.url))},
  reference: {type: 'string', default: fileURLToPath(new URL('./reference/obstacle-reference', import.meta.url))},
  pairs: {type: 'string', default: '1'},
  offset: {type: 'string', default: '0'},
  budgets: {type: 'string', default: '100,500,1500'},
  kind: {type: 'string', default: 'both'},
  'candidate-sdk': {type: 'string'},
  'baseline-sdk': {type: 'string'},
  opponent: {type: 'string', default: 'reference'},
  holdout: {type: 'boolean', default: false},
  'ply-cap': {type: 'string', default: '180'},
  'validate-openings': {type: 'boolean', default: false},
}});
const root = resolve(options['game-root']);
const budgets = options.budgets.split(',').map(Number);
const kinds = options.kind === 'both' ? ['pit', 'blackhole'] : [options.kind];
const pairCount = Number(options.pairs);
const pairOffset = Number(options.offset);
const plyCap = Number(options['ply-cap']);
assert.ok(budgets.length && budgets.every(ms => [100, 500, 1500].includes(ms)));
assert.ok(kinds.every(kind => ['pit', 'blackhole'].includes(kind)));
assert.ok(['reference', 'baseline'].includes(options.opponent));
assert.ok(Number.isSafeInteger(pairCount) && pairCount > 0);
assert.ok(Number.isSafeInteger(pairOffset) && pairOffset >= 0);
assert.ok(Number.isSafeInteger(plyCap) && plyCap > 0);

const {toObstaclePosition, toUsi} = await import(pathToFileURL(resolve(root, 'ai/rsshogi-position.mjs')));
const gameSource = await readFile(resolve(root, 'index.html'), 'utf8');
function section(start, end) {
  const first = gameSource.indexOf(start);
  const last = gameSource.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Missing rules section ' + start);
  return gameSource.slice(first, last);
}
const matchMath = Object.create(Math);
const ruleSource = [
  section('const $=id=>', 'const names='),
  section('const rand=n=>', 'let g=null'),
  section('const shallowBoard=', 'function drawCeremony('),
  section('function repeatHash(', '// Dedicated pre-match selection view.'),
].join('\n');
const game = new Function('Math', ruleSource +
  '\nreturn {getLegal, inCheck, independentBoard, blackholeCells, isInnerHole, repeatHash, sim};')(matchMath);
const values = {P: 100, L: 300, N: 350, S: 450, G: 550, B: 825, R: 1000, K: 0};
const clockMs = 180000;
const log = (event, data) => console.log(JSON.stringify({event, ...data}));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function play(position, move) {
  const {board, hands, turn, steps} = position;
  const captured = board[move.to];
  const nextHands = hands.map(hand => ({...hand}));
  if (captured) {
    assert.notEqual(captured.type, 'K');
    nextHands[turn][captured.type] = (nextHands[turn][captured.type] || 0) + 1;
  }
  if (move.drop) nextHands[turn][move.drop]--;
  return {...position, board: game.sim(position, move, turn).board, hands: nextHands, turn: 1 - turn, steps: steps + 1};
}

function materialGap(position) {
  let gap = 0;
  for (const piece of position.board) {
    if (piece) gap += (piece.side ? -1 : 1) * (values[piece.type] + (piece.pr ? 100 : 0));
  }
  for (const [side, hand] of position.hands.entries()) {
    for (const [piece, count] of Object.entries(hand)) gap += (side ? -1 : 1) * count * values[piece];
  }
  return gap;
}

function hasOnePlyWin(position, moves) {
  return moves.some(move => {
    const next = play(position, move);
    return game.getLegal(next, next.turn).length === 0;
  });
}

function opening(kind, pair) {
  const random = seededRandom((options.holdout ? 0x7b69fe12 : 0x144f4ea9) ^ Math.imul(pair + 1, 0x9e3779b9));
  matchMath.random = random;
  const stage = options.holdout ? ['opening', 'middle', 'reduced'][pair % 3] : pair % 2 ? 'middle' : 'opening';
  const warmup = stage === 'opening' ? 8 : stage === 'middle' ? 24 : 16;
  for (let attempt = 0; attempt < 400; attempt++) {
    let original = {board: game.independentBoard(), hands: [{}, {}], turn: 0, steps: 0, holes: []};
    if (stage === 'reduced') {
      const types = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
      const keepTypes = Array.from({length: 5}, () => types[Math.floor(random() * types.length)]);
      for (const side of [0, 1]) {
        const keep = keepTypes.slice();
        original.board = original.board.map(piece => {
          if (!piece || piece.side !== side || piece.type === 'K') return piece;
          const index = keep.indexOf(piece.type);
          if (index < 0) return null;
          keep.splice(index, 1);
          return piece;
        });
      }
    }
    while (original.steps < warmup) {
      const moves = game.getLegal(original, original.turn);
      if (!moves.length) break;
      const captures = moves.filter(move => original.board[move.to]);
      const pool = captures.length && random() < 0.25 ? captures : moves;
      original = play(original, pool[Math.floor(random() * pool.length)]);
    }
    if (original.steps !== warmup) continue;
    const centers = original.board.flatMap((piece, square) =>
      !piece && game.isInnerHole(square) ? [square] : []);
    if (!centers.length) continue;
    const center = centers[Math.floor(random() * centers.length)];
    const holes = kind === 'pit' ? [center] : game.blackholeCells(center);
    const absorbed = holes.map(square => original.board[square]).filter(Boolean);
    if (kind === 'blackhole' && (!absorbed.length || absorbed.some(piece => piece.type === 'K'))) continue;
    const board = original.board.slice();
    for (const square of holes) board[square] = null;
    const after = {...original, board, holes};
    if (Math.abs(materialGap(after)) > 650 || [0, 1].some(side => game.inCheck(after, side))) continue;
    const bothSidesPlayable = [0, 1].every(turn => {
      const start = {...after, turn};
      const moves = game.getLegal(start, turn);
      return moves.length >= 12 && !hasOnePlyWin(start, moves);
    });
    if (bothSidesPlayable) return {position: after, absorbed, warmup, gap: materialGap(after), stage};
  }
  throw Error('No eligible opening for ' + kind + ' pair ' + pair);
}

class Reference {
  constructor(binary) {
    this.process = spawn(binary, {stdio: ['pipe', 'pipe', 'inherit']});
    this.process.on('error', error => this.finish(error));
    this.process.on('exit', (code, signal) => this.finish(Error(`Reference exited (${code ?? signal})`)));
    this.process.stdin.on('error', error => this.finish(error));
    this.lines = createInterface({input: this.process.stdout});
    this.lines.on('line', line => {
      try {
        const result = JSON.parse(line);
        this.finish(result.error ? Error(result.error) : null, result);
      } catch (error) {
        this.finish(error);
      }
    });
  }

  finish(error, result) {
    if (error && !this.active) this.failure = error;
    if (!this.active) return;
    const {timer, resolve: accept, reject} = this.active;
    this.active = null;
    clearTimeout(timer);
    if (error) reject(error);
    else accept(result);
  }

  request(fields, timeout = 10000) {
    if (this.failure) return Promise.reject(this.failure);
    assert.ok(!this.active);
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => {
        this.failure = Error(`Reference ${fields[0]} timeout`);
        this.finish(this.failure);
        this.process.kill();
      }, timeout);
      this.active = {timer, resolve: accept, reject};
      this.process.stdin.write(fields.join('\t') + '\n');
    });
  }

  async legal({sfen, holes}) {
    return (await this.request(['legal', sfen, holes.join(',') || '-'])).moves;
  }

  close() {
    this.lines.close();
    this.process.stdin.end();
    this.process.kill();
  }
}

class BrowserWorker {
  constructor(source) {
    this.sequence = 0;
    this.worker = new Worker(`
      const {parentPort, workerData} = require('node:worker_threads');
      globalThis.self = globalThis;
      globalThis.postMessage = data => parentPort.postMessage(data);
      const loaded = import(workerData);
      parentPort.on('message', async data => {
        await loaded;
        self.onmessage({data});
      });
    `, {eval: true, workerData: pathToFileURL(source).href});
    this.worker.on('error', error => {this.error = error;});
  }

  request(command, fields = {}, timeout = 10000) {
    if (this.error) return Promise.reject(this.error);
    return new Promise((accept, reject) => {
      const id = ++this.sequence;
      const finish = (error, result) => {
        clearTimeout(timer);
        this.worker.off('message', receive);
        this.worker.off('error', onError);
        if (error) reject(error);
        else accept(result);
      };
      const onError = error => finish(error);
      const receive = message => {
        if (message.id !== id || message.event === 'info') return;
        finish(message.ok ? null : Error(message.error), message.result);
      };
      const timer = setTimeout(() => finish(Error(`NNUE ${command} timeout`)), timeout);
      this.worker.on('message', receive);
      this.worker.on('error', onError);
      this.worker.postMessage({id, command, ...fields});
    });
  }
}

async function confirmLegal(engine, position, legal) {
  const payload = toObstaclePosition(position);
  assert.ok(payload, 'SFEN cannot represent match position');
  const current = legal.map(toUsi).sort();
  const independent = (await engine.legal(payload)).sort();
  assert.deepEqual(independent, current, JSON.stringify(payload));
  return payload;
}

async function timedWorkerSearch(worker, payload, budget) {
  await worker.request('position', payload);
  return worker.request('go', {depth: 64, movetime_ms: budget}, budget + 1750);
}

async function playGame(worker, baseline, binary, openingPosition, nnueSide, budget) {
  const reference = new Reference(binary);
  let position = structuredClone(openingPosition);
  const turns = [];
  const seen = new Map([[game.repeatHash(position), 1]]);
  const clocks = [clockMs, clockMs];
  try {
    await worker.request('new_game');
    if (baseline) await baseline.request('new_game');
    for (let ply = 0; ply <= plyCap; ply++) {
      const side = position.turn;
      const legal = game.getLegal(position, side);
      const payload = await confirmLegal(reference, position, legal);
      if (!legal.length) return {winner: 1 - side, reason: game.inCheck(position, side) ? 'mate' : 'no-legal', turns, clocks};
      if (ply === plyCap) return {winner: null, reason: 'ply-cap', turns, clocks};
      const requestMs = Math.max(1, Math.min(budget, Math.floor(clocks[side] / 20), clocks[side] - 150));
      const searchSide = side === nnueSide ? 'nnue' : baseline ? 'baseline' : 'reference';
      const started = performance.now();
      let result;
      try {
        if (side === nnueSide) {
          result = await timedWorkerSearch(worker, payload, requestMs);
        } else if (baseline) {
          result = await timedWorkerSearch(baseline, payload, requestMs);
        } else {
          result = await reference.request(['go', requestMs, payload.sfen, payload.holes.join(',')], requestMs + 1750);
        }
      } catch (error) {
        if (!error.message.endsWith('timeout')) throw error;
        return {winner: 1 - side, reason: 'search-timeout', detail: {searchSide, ...payload, message: error.message}, turns, clocks};
      }
      const elapsed = performance.now() - started;
      clocks[side] -= elapsed;
      turns.push({side, engine: searchSide, bestmove: result.bestmove, depth: result.depth,
        nodes: result.nodes, elapsed, reportedMs: result.elapsed_ms, requestMs});
      if (clocks[side] <= 0) return {winner: 1 - side, reason: 'clock', turns, clocks};
      if (result.bestmove === 'resign') return {winner: 1 - side, reason: 'resign', turns, clocks};
      const move = legal.find(candidate => toUsi(candidate) === result.bestmove);
      if (!move) return {winner: 1 - side, reason: 'illegal', detail: payload, turns, clocks};
      position = play(position, move);
      const key = game.repeatHash(position);
      const repeats = (seen.get(key) ?? 0) + 1;
      if (repeats === 4) return {winner: null, reason: 'repetition', turns, clocks};
      seen.set(key, repeats);
    }
    throw Error('Unreachable match end');
  } finally {
    reference.close();
  }
}

const prepared = new Map();
for (let pair = pairOffset; pair < pairOffset + pairCount; pair++) {
  for (const kind of kinds) {
    const fixture = opening(kind, pair);
    prepared.set(pair + kind, fixture);
    if (options['validate-openings']) {
      log('opening', {pair, kind, ...toObstaclePosition(fixture.position),
        absorbed: fixture.absorbed, warmup: fixture.warmup, gap: fixture.gap, stage: fixture.stage,
        legal: game.getLegal(fixture.position, fixture.position.turn).length});
    }
  }
}

if (!options['validate-openings']) {
  const directory = resolve(options['candidate-sdk'] || resolve(root, 'ai/obstacle-sdk'));
  const wasm = await readFile(resolve(directory, 'rsshogi_nnue_mini.wasm'));
  const workerSource = resolve(directory, 'worker.js');
  const binary = resolve(options.reference);
  const baselineRoot = resolve(options['baseline-sdk'] || resolve(root, 'ai/obstacle-sdk'));
  const baselineWasm = options.opponent === 'baseline' ? await readFile(resolve(baselineRoot, 'rsshogi_nnue_mini.wasm')) : null;
  log('config', {budgets, kinds, pairCount, pairOffset, plyCap, clockMs,
    holdout: options.holdout, opponent: options.opponent, baselineSha256: baselineWasm ? hash(baselineWasm) : null,
    referenceBinary: binary, referenceSha256: hash(await readFile(binary)),
    gameCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    rulesSha256: hash(ruleSource), wasmSha256: hash(wasm), workerSha256: hash(await readFile(workerSource)),
    hashMb: 16, node: process.version});
  const worker = new BrowserWorker(workerSource);
  const baseline = baselineWasm ? new BrowserWorker(resolve(baselineRoot, 'worker.js')) : null;
  try {
    await worker.request('init', {wasm, hash_mb: 16});
    if (baseline) await baseline.request('init', {wasm: baselineWasm, hash_mb: 16});
    for (let pair = pairOffset; pair < pairOffset + pairCount; pair++) {
      for (const budget of budgets) {
        for (const kind of kinds) {
          const {position, absorbed, warmup, gap, stage} = prepared.get(pair + kind);
          for (const nnueSide of [pair % 2, 1 - pair % 2]) {
            const labels = {budget, kind, pair, nnueSide, start: toObstaclePosition(position), absorbed, warmup, gap, stage};
            log('game-start', labels);
            log('game', {...labels, ...await playGame(worker, baseline, binary, position, nnueSide, budget)});
          }
        }
      }
    }
  } finally {
    await worker.worker.terminate();
    if (baseline) await baseline.worker.terminate();
  }
}
